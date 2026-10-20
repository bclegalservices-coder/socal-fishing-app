import random
from datetime import datetime, timedelta, timezone

from alerts import engine
from features.ads import choose
from features.offline import style

NOW = datetime(2026, 10, 3, 18, tzinfo=timezone.utc)


def test_ad_choice_prefers_context():
    rows = [{"id": 1, "context_tags": ["tuna"]}, {"id": 2, "context_tags": ["bass"]}, {"id": 3, "context_tags": []}]
    assert choose(rows, ["tuna", "offshore"], random.Random(1))["id"] == 1
    ids = {choose(rows, [], random.Random(i))["id"] for i in range(30)}
    assert ids == {1, 2, 3}  # no context: fair rotation
    assert choose([], ["x"]) is None


def test_offline_style_lists_tiles():
    s = style(["https://a/{z}/{x}/{y}.png", "https://b/{z}/{x}/{y}.png"])
    assert s["version"] == 8 and s["sources"]["s1"]["tiles"] == ["https://b/{z}/{x}/{y}.png"] and len(s["layers"]) == 3
    assert s["sources"]["s0"]["tileSize"] == 256
    e = style(["https://noaa/export?bbox={bbox-epsg-3857}&f=image"])
    assert e["sources"]["s0"]["tileSize"] == 512


def _c(code, minutes_ago, lat=33.35, lon=-118.4, verified=True, q=1):
    return {"species_code": code, "caught_at": NOW - timedelta(minutes=minutes_ago), "lat": lat, "lon": lon, "verified": verified, "quantity": q}


def test_species_alert_area_species_and_verified():
    sub = {"params": {"species": ["BFT"], "center": [-118.4, 33.35], "radius_nm": 10, "verified_only": True, "label": "Catalina"}, "last_sent_at": None}
    catches = [_c("BFT", 20, q=3), _c("BFT", 30, verified=False), _c("YT", 10), _c("BFT", 15, lat=32.0)]
    msg = engine.species_alert(sub, catches, NOW)
    assert msg == "1 verified bluefin report near Catalina (3 fish)."
    sub["last_sent_at"] = NOW - timedelta(minutes=5)
    assert engine.species_alert(sub, catches, NOW) is None


def test_activity_alert_needs_jump():
    sub = {"params": {"species": ["YT"], "center": [-118.4, 33.35], "radius_nm": 20, "label": "Catalina"}}
    recent = [_c("YT", m) for m in (10, 40, 70, 100, 130, 160)]
    assert "6 reports" in engine.activity_alert(sub, recent, NOW)
    older = [_c("YT", 60 * 7 + m) for m in range(0, 300, 60)]
    assert engine.activity_alert(sub, recent + older, NOW) is None   # 6 vs 5: not a jump


def test_sst_alert_once_a_day():
    sub = {"params": {"min_f": 68, "max_f": 72, "radius_nm": 15, "label": "Catalina"}, "last_sent_at": None}
    assert engine.sst_alert(sub, [66, 67, 69, 70, None], "2026-10-02", NOW).startswith("Water 68–72°F")
    assert engine.sst_alert(sub, [60] * 20 + [69], "2026-10-02", NOW) is None
    sub["last_sent_at"] = NOW - timedelta(hours=2)
    assert engine.sst_alert(sub, [69, 70], "2026-10-02", NOW) is None


def test_weather_alert_each_warning_once():
    sub = {"params": {"label": "San Pedro Channel"}, "state": {}}
    al = [{"event": "Small Craft Advisory", "ends": "2026-10-04T03:00:00Z"}]
    msg, ids = engine.weather_alert(sub, al)
    assert msg == "Small Craft Advisory near San Pedro Channel." and ids
    sub["state"] = {"seen": ids}
    assert engine.weather_alert(sub, al)[0] is None


def test_rate_limits():
    assert engine.can_send({"last_sent_at": None}, 0, NOW)
    assert not engine.can_send({"last_sent_at": None}, engine.MAX_PER_DAY, NOW)
    assert not engine.can_send({"last_sent_at": NOW - timedelta(hours=1)}, 0, NOW)
