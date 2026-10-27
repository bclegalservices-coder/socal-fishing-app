"""Spotter-plane push alerts (Oct 27).

The server keeps watching the air traffic around the clock (every ~75 s). When a plane is circling low and slow over
the water (a likely spotter, see traffic.py) inside someone's "Spotter plane" alert area, that person gets a push:
  "Spotter plane circling low near Catalina — N123SP at 1,200 ft, 4 circles in 12 min."
Rules: each plane at most once per 90 minutes per alert, at most 6 spotter alerts per person per day.
Pro switch: when app_config.spotter_premium is true, only Pro members get them.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import time
from datetime import datetime, timedelta, timezone

PER_DAY = 6
SAME_PLANE = timedelta(minutes=90)
EVERY_S = 75
EXPO = "https://exp.host/--/api/v2/push/send"


def nm(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 2 * 3440.065 * math.asin(min(1, math.sqrt(h)))


def message(sub: dict, p: dict) -> str:
    who = p.get("reg") or p.get("callsign") or "A plane"
    alt = f"{int(round((p.get('alt_ft') or 0) / 50.0) * 50):,} ft" if p.get("alt_ft") is not None else "low"
    label = sub["params"].get("label") or "your area"
    near = "near you" if label == "Near me" else f"near {label}"
    loops = f", {p['circles']:g} circles in {round(p.get('loiter_min') or 0)} min" if p.get("circles") else ""
    return f"Spotter plane circling low {near} — {who} at {alt}{loops}. Tap to see it."


def decide(subs: list[dict], planes: list[dict], now: datetime, premium: bool, pro_users: set) -> list[tuple[dict, dict, str, dict]]:
    """[(subscription, plane, text, new_state)] — pure, so it's tested without a database or network."""
    out = []
    spotters = [p for p in planes if p.get("spotter")]
    if not spotters:
        return out
    day = now.astimezone(timezone(timedelta(hours=-8))).strftime("%Y-%m-%d")   # Pacific-ish day for the daily cap
    sent_today: dict = {}
    for s in subs:
        if s.get("kind") != "spotter" or not s.get("active", True):
            continue
        if premium and s["user_id"] not in pro_users:
            continue
        params = s.get("params") or {}
        c = params.get("center")
        if not c:
            continue
        radius = float(params.get("radius_nm", 15))
        st = dict(s.get("state") or {})
        n_today = st.get("n", 0) if st.get("day") == day else 0
        user_n = sent_today.get(s["user_id"], 0)
        if n_today >= PER_DAY or user_n >= PER_DAY:
            continue
        sent = {k: v for k, v in (st.get("sent") or {}).items() if now - datetime.fromisoformat(v) < SAME_PLANE}
        cands = [p for p in spotters if p["hex"] not in sent and nm(c[1], c[0], p["lat"], p["lon"]) <= radius]
        if not cands:
            continue
        p = min(cands, key=lambda q: nm(c[1], c[0], q["lat"], q["lon"]))
        sent[p["hex"]] = now.isoformat()
        new_state = {**st, "sent": sent, "day": day, "n": n_today + 1}
        sent_today[s["user_id"]] = user_n + 1
        out.append((s, p, message(s, p), new_state))
    return out


async def tick(pool, fetch_planes, send) -> int:
    """One check: planes → who to tell → push. Returns how many alerts went out."""
    snap = await fetch_planes()
    planes = [p for p in snap.get("planes", []) if p.get("spotter")]
    if not planes or pool is None:
        return 0
    async with pool.connection() as conn:
        subs = await (await conn.execute(
            "select id, user_id, kind, params, state, active from alert_subscriptions where active and kind = 'spotter'")).fetchall()
        if not subs:
            return 0
        row = await (await conn.execute("select value from app_config where key = 'spotter_premium'")).fetchone()
        premium = bool(row and (row["value"] is True or row["value"] == "true"))
        pro = set()
        if premium:
            pro = {r["user_id"] for r in await (await conn.execute(
                "select user_id from subscriptions where tier = 'pro' and status = 'active' and (expires_at is null or expires_at > now())")).fetchall()}
        todo = decide([dict(s) for s in subs], planes, datetime.now(timezone.utc), premium, pro)
        if not todo:
            return 0
        users = list({s["user_id"] for s, *_ in todo})
        toks: dict = {}
        for r in await (await conn.execute("select user_id, token from push_tokens where user_id = any(%s)", (users,))).fetchall():
            toks.setdefault(r["user_id"], []).append(r["token"])
        msgs = []
        for s, p, text, state in todo:
            await conn.execute("update alert_subscriptions set state = %s::jsonb, last_sent_at = now() where id = %s", (json.dumps(state), s["id"]))
            await conn.execute("insert into notification_log (user_id, subscription_id, body) values (%s, %s, %s)", (s["user_id"], s["id"], text))
            for t in toks.get(s["user_id"], []):
                msgs.append({"to": t, "title": "Spotter plane", "body": text, "sound": "default",
                             "data": {"type": "spotter", "lat": p["lat"], "lon": p["lon"], "hex": p["hex"], "label": p.get("reg") or "Spotter plane"}})
    if msgs:
        await send(msgs)
    return len(todo)


async def _send_expo(msgs: list[dict]):
    from core.http import client
    for i in range(0, len(msgs), 100):
        try:
            await client().post(EXPO, json=msgs[i:i + 100], headers={"Accept": "application/json"})
        except Exception as e:
            print("spotter push failed", type(e).__name__)


async def loop(pool):
    """Started with the server. Keeps the air picture fresh 24/7 and sends spotter alerts."""
    from .traffic import TRACKER, _depth_lookup, _fetch
    if os.environ.get("AIR_ALERTS", "1") == "0":
        return

    async def planes():
        await TRACKER.refresh(_fetch)
        return TRACKER.snapshot(time.time(), _depth_lookup())

    await asyncio.sleep(20)
    while True:
        try:
            n = await tick(pool, planes, _send_expo)
            if n:
                print(f"spotter alerts sent: {n}")
        except Exception as e:                      # never let the watcher die
            print("spotter watcher:", type(e).__name__, str(e)[:120])
        await asyncio.sleep(EVERY_S)
