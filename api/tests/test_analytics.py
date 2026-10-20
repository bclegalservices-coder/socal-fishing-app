from datetime import datetime, timezone

from features.analytics import clean_batch, clean_props, rate_ok

NOW = datetime(2026, 10, 3, 18, tzinfo=timezone.utc)
IID = "6f1c1d6e-3b2a-4d5e-9f00-112233445566"


def test_props_drop_anything_location_or_personal():
    p = clean_props({"layer": "sst", "lat": 33.4, "lon": -118.1, "email": "a@b.c", "screen": "today", "species": "BFT",
                     "note": "my spot", "where": "33.40125,-117.99667", "count": 3, "stopped": True, "Bad-Key": 1})
    assert p == {"layer": "sst", "screen": "today", "species": "BFT", "count": 3, "stopped": True}


def test_batch_validation():
    b = clean_batch({"install_id": IID, "platform": "ios", "app_version": "1.0.0", "area": "Catalina", "signed_in": True,
                     "events": [{"name": "app_open", "at": "2026-10-03T17:59:00Z", "props": {"stopped": True}},
                                {"name": "evil_event", "at": "2026-10-03T17:59:00Z"},
                                {"name": "screen_view", "at": "2030-01-01T00:00:00Z", "props": {"screen": "today"}}]}, NOW)
    assert [e["name"] for e in b["events"]] == ["app_open", "screen_view"]
    assert b["events"][1]["at"] == NOW                       # future timestamps are clamped
    assert str(b["events"][0]["day"]) == "2026-10-03"        # Pacific-time day
    assert b["area"] == "Catalina" and b["platform"] == "ios"
    assert clean_batch({"install_id": IID, "area": "33.4,-118"}, NOW)["area"] == "Unknown"


def test_bad_install_id_rejected():
    try:
        clean_batch({"install_id": "nope"}, NOW)
        assert False
    except ValueError:
        pass


def test_rate_limit():
    assert rate_ok("x", 300)
    assert not rate_ok("x", 200)
