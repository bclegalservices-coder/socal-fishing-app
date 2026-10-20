import hashlib
import hmac
import json


def _sign(payload: bytes, secret: str, ts: int) -> str:
    return f"t={ts},v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()


def test_stripe_signature():
    from features.billing import verify_signature
    body = json.dumps({"type": "checkout.session.completed"}).encode()
    sig = _sign(body, "whsec_test", 1_800_000_000)
    assert verify_signature(body, sig, "whsec_test", now=1_800_000_010)
    assert not verify_signature(body + b" ", sig, "whsec_test", now=1_800_000_010), "tampered body"
    assert not verify_signature(body, sig, "whsec_other", now=1_800_000_010), "wrong secret"
    assert not verify_signature(body, sig, "whsec_test", now=1_800_000_000 + 3600), "replayed an hour later"
    assert not verify_signature(body, None, "whsec_test")
    assert not verify_signature(body, "garbage", "whsec_test")
    # Stripe may send several v1 signatures while rotating secrets
    two = sig.replace("v1=", "v1=deadbeef,v1=", 1)
    assert verify_signature(body, two, "whsec_test", now=1_800_000_010)


def test_checkout_form():
    from features.billing import checkout_form
    f = checkout_form({"id": 42, "placement": "presented_by", "section": "Weather", "price_cents": 7000,
                       "advertiser": "Bob's Bait", "start_date": "2026-10-26", "weeks": 2}, "https://studio.example/", "bob@x.com")
    assert f["line_items[0][price_data][unit_amount]"] == "7000"
    assert f["metadata[order_id]"] == "42" and f["client_reference_id"] == "42"
    assert f["success_url"] == "https://studio.example/#order/42?paid=1"
    assert "Presented By — Weather" in f["line_items[0][price_data][product_data][name]"]
    assert f["customer_email"] == "bob@x.com"


def test_ad_payload_shapes():
    from features.ads import EVENTS, shape
    new = shape({"id": 7, "placement": "sponsor_intro", "creative_url": "https://c/poster.jpg", "click_url": None, "headline": "Fresh squid",
                 "advertiser": "Bob", "max_per_user_per_day": 2,
                 "creative": {"kind": "video", "media_url": "https://c/a.mp4", "poster_url": "https://c/poster.jpg", "duration_s": 8,
                              "action_type": "call", "action_value": "(949) 555-0101", "id": "secret-uuid"}})
    assert new["creative"]["kind"] == "video" and new["creative"]["action_type"] == "call"
    assert "id" not in new["creative"], "only display fields go to phones"
    old = shape({"id": 3, "placement": "banner_dashboard", "creative_url": "https://c/b.png", "click_url": "https://bob.example", "creative": None})
    assert old["creative"] == {"kind": "image", "media_url": "https://c/b.png", "action_type": "website", "action_value": "https://bob.example"}
    assert {"coupon_save", "call", "directions", "video_complete"} <= EVENTS
