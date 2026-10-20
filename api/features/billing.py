"""Ad payments with Stripe Checkout — no Stripe library needed, just two HTTPS calls.

Flow: you approve an ad in the Ad Studio → the advertiser clicks "Pay now" → POST /billing/checkout
(with their sign-in token) → Stripe's hosted card page → Stripe calls POST /billing/webhook → the order is
marked paid and goes live. Cash/check/Venmo/Zelle are marked paid by you in the Studio instead.

Env vars (Render): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY, STUDIO_URL.
Without STRIPE_SECRET_KEY the Studio simply hides the card button.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlencode

import httpx

STRIPE_API = "https://api.stripe.com/v1"


def enabled() -> bool:
    return bool(os.environ.get("STRIPE_SECRET_KEY"))


def verify_signature(payload: bytes, header: str | None, secret: str, tolerance: int = 300, now: float | None = None) -> bool:
    """Stripe-Signature: t=<unix>,v1=<hex hmac sha256 of "<t>.<payload>">. Rejects stale or forged calls."""
    if not header or not secret:
        return False
    parts: dict[str, list[str]] = {}
    for item in header.split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts.get("t", ["0"])[0])
    except ValueError:
        return False
    if abs((now or time.time()) - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", []))


def checkout_form(order: dict, studio_url: str, email: str | None) -> dict[str, str]:
    """Form fields for POST /v1/checkout/sessions (one line item, the order's final price)."""
    oid = str(order["id"])
    label = order["placement"].replace("_", " ").title() + (f" — {order['section']}" if order.get("section") else "")
    form = {
        "mode": "payment",
        "success_url": f"{studio_url.rstrip('/')}/#order/{oid}?paid=1",
        "cancel_url": f"{studio_url.rstrip('/')}/#order/{oid}",
        "client_reference_id": oid,
        "metadata[order_id]": oid,
        "payment_intent_data[metadata][order_id]": oid,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(int(order["price_cents"])),
        "line_items[0][price_data][product_data][name]": f"Ad #{oid}: {label}",
        "line_items[0][price_data][product_data][description]":
            f"{order['advertiser']} · {order['start_date']} for {order['weeks']} week{'s' if order['weeks'] != 1 else ''}",
    }
    if email:
        form["customer_email"] = email
    return form


async def user_from_token(token: str) -> dict | None:
    """Ask Supabase who this sign-in token belongs to (works with any key type)."""
    url, anon = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_ANON_KEY")
    if not (url and anon and token):
        return None
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(f"{url.rstrip('/')}/auth/v1/user", headers={"apikey": anon, "Authorization": f"Bearer {token}"})
    return r.json() if r.status_code == 200 else None


ORDER_SQL = """
select o.id, o.placement::text placement, o.section, o.start_date::text start_date, o.weeks, o.price_cents, o.status, o.payment_status,
       a.name advertiser, a.contact_email,
       exists (select 1 from advertiser_users u where u.advertiser_id = o.advertiser_id and u.user_id = %(uid)s::uuid)
       or coalesce((select is_admin from profiles where id = %(uid)s::uuid), false) allowed
from ad_orders o join advertisers a on a.id = o.advertiser_id where o.id = %(id)s"""


async def create_checkout(pool, order_id: int, token: str) -> dict:
    if not enabled():
        raise PermissionError("Card payments aren't set up yet — pay by Zelle/Venmo/check and we'll mark it paid.")
    user = await user_from_token(token)
    if not user:
        raise PermissionError("Please sign in again.")
    async with pool.connection() as conn:
        o = await (await conn.execute(ORDER_SQL, {"uid": user["id"], "id": order_id})).fetchone()
    if not o or not o["allowed"]:
        raise LookupError("Order not found")
    if o["status"] != "approved":
        raise ValueError("This ad hasn't been approved yet — you'll be able to pay as soon as it is.")
    if o["payment_status"] != "unpaid":
        raise ValueError("This ad is already paid.")
    if int(o["price_cents"]) < 50:
        raise ValueError("Nothing to pay on this order.")
    studio = os.environ.get("STUDIO_URL", "")
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.post(f"{STRIPE_API}/checkout/sessions", content=urlencode(checkout_form(o, studio, user.get("email") or o["contact_email"])),
                            headers={"Authorization": f"Bearer {os.environ['STRIPE_SECRET_KEY']}", "Content-Type": "application/x-www-form-urlencoded"})
    if r.status_code != 200:
        raise RuntimeError(f"Stripe: {r.json().get('error', {}).get('message', r.text[:200])}")
    sess = r.json()
    async with pool.connection() as conn:
        await conn.execute("update ad_orders set stripe_session_id = %s, updated_at = now() where id = %s", (sess["id"], order_id))
    return {"url": sess["url"]}


async def handle_webhook(pool, payload: bytes, signature: str | None) -> dict:
    if not verify_signature(payload, signature, os.environ.get("STRIPE_WEBHOOK_SECRET", "")):
        raise PermissionError("bad signature")
    event = json.loads(payload)
    if event.get("type") not in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        return {"ignored": event.get("type")}
    s = event["data"]["object"]
    if s.get("payment_status") != "paid":
        return {"pending": s.get("id")}
    order_id = int((s.get("metadata") or {}).get("order_id") or s.get("client_reference_id") or 0)
    async with pool.connection() as conn:
        row = await (await conn.execute("select stripe_mark_paid(%s, %s, %s) ok", (order_id, s["id"], int(s.get("amount_total") or 0)))).fetchone()
    return {"order_id": order_id, "marked_paid": bool(row and row["ok"])}
