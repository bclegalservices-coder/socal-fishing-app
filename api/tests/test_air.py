"""Live air traffic: circling / likely-spotter detection, filtering, and sharing one source request (no network)."""
import asyncio
import math


def _orbit(t0, n, lat0=33.30, lon0=-118.45, r_nm=0.8, period_s=150, step=10, alt=1200, gs=95):
    """A plane circling a spot (like a spotter over a school of fish)."""
    out = []
    for i in range(n):
        t = t0 + i * step
        ang = 2 * math.pi * (t - t0) / period_s
        lat = lat0 + (r_nm / 60) * math.sin(ang)
        lon = lon0 + (r_nm / 60) * math.cos(ang) / math.cos(math.radians(lat0))
        track = (math.degrees(-ang) + 360) % 360                    # heading changes steadily
        out.append((t, {"hex": "a1b2c3", "r": "N123SP", "t": "C182", "lat": lat, "lon": lon, "alt_baro": alt, "gs": gs,
                        "track": track, "seen_pos": 0}))
    return out


def _straight(t0, n, step=10, hexid="ffff01", alt=1500, gs=120, track=135, t="C172"):
    out = []
    for i in range(n):
        d = i * step * gs / 3600 / 60
        out.append((t0 + i * step, {"hex": hexid, "t": t, "lat": 33.6 - d * 0.7, "lon": -118.9 + d * 0.7, "alt_baro": alt,
                                    "gs": gs, "track": track, "seen_pos": 0}))
    return out


def _feed(tr, *series):
    by_t = {}
    for s in series:
        for t, a in s:
            by_t.setdefault(t, []).append(a)
    for t in sorted(by_t):
        tr.ingest(by_t[t], t)
    return max(by_t)


def test_circling_low_plane_over_water_is_a_likely_spotter():
    from air.traffic import Tracker
    tr = Tracker()
    t_end = _feed(tr, _orbit(1000.0, 60), _straight(1000.0, 60))
    snap = tr.snapshot(t_end, depth_lookup=lambda lat, lon: 900.0)          # all water
    byhex = {p["hex"]: p for p in snap["planes"]}
    sp = byhex["a1b2c3"]
    assert sp["circling"] and sp["spotter"] and sp["circles"] >= 2
    assert not byhex["ffff01"]["circling"] and not byhex["ffff01"]["spotter"]
    assert snap["planes"][0]["hex"] == "a1b2c3"                              # spotters listed first
    assert "a1b2c3" in snap["trails"] and len(snap["trails"]["a1b2c3"]) > 20
    assert snap["circling"] == 1 and snap["spotters"] == 1


def test_circling_over_land_or_high_is_circling_but_not_a_spotter():
    from air.traffic import Tracker
    tr = Tracker()
    t_end = _feed(tr, [(t, {**a, "alt_baro": 6500}) for t, a in _orbit(0.0, 60)])
    p = tr.snapshot(t_end, depth_lookup=lambda lat, lon: 900.0)["planes"][0]
    assert p["circling"] and not p["spotter"]                                # too high for a spotter
    tr2 = Tracker()
    t_end = _feed(tr2, _orbit(0.0, 60))
    p2 = tr2.snapshot(t_end, depth_lookup=lambda lat, lon: float("nan"))["planes"][0]
    assert p2["circling"] and not p2["water"] and not p2["spotter"]        # over land (news, police, flight school)


def test_airliners_up_high_hidden_unless_asked_and_helicopters_never_spotters():
    from air.traffic import Tracker
    tr = Tracker()
    jet = _straight(0.0, 20, hexid="aa0001", alt=35000, gs=460, t="B738")
    heli = [(t, {**a, "hex": "he0001", "t": "R44", "category": "A7"}) for t, a in _orbit(0.0, 60)]
    t_end = _feed(tr, jet, heli)
    snap = tr.snapshot(t_end, depth_lookup=lambda lat, lon: 500.0)
    hexes = {p["hex"] for p in snap["planes"]}
    assert "aa0001" not in hexes and "he0001" in hexes
    h = [p for p in snap["planes"] if p["hex"] == "he0001"][0]
    assert h["kind"] == "heli" and h["circling"] and not h["spotter"]
    assert "aa0001" in {p["hex"] for p in tr.snapshot(t_end, lambda a, b: 500.0, include_high=True)["planes"]}


def test_one_request_shared_and_falls_back_to_next_source():
    import os
    from air import traffic
    calls = []

    async def fetch(url):
        calls.append(url)
        if "adsb.lol" in url:
            raise RuntimeError("down")
        return {"now": 1_700_000_000_000, "ac": [{"hex": "abc123", "lat": 33.2, "lon": -118.4, "alt_baro": 900, "gs": 80, "track": 10, "seen_pos": 1}]}

    os.environ["AIR_ALLOW_NONCOMMERCIAL"] = "1"
    try:
        tr = traffic.Tracker()
        asyncio.run(tr.refresh(fetch, now=1_700_000_000.0))
        asyncio.run(tr.refresh(fetch, now=1_700_000_003.0))               # 3 s later: no new request
        assert len(calls) == 2 and "adsb.lol" in calls[0] and "airplanes.live" in calls[1]
        snap = tr.snapshot(1_700_000_003.0, depth_lookup=lambda a, b: 300.0)
        assert snap["count"] == 1 and snap["source"] == "api.airplanes.live" and snap["error"] is None
    finally:
        os.environ.pop("AIR_ALLOW_NONCOMMERCIAL", None)
    assert all("airplanes.live" not in s for s in traffic.sources())         # off by default (non-commercial terms)


def test_forgets_planes_not_heard_for_ten_minutes():
    from air.traffic import Tracker
    tr = Tracker()
    tr.ingest([{"hex": "old111", "lat": 33.0, "lon": -118.5, "alt_baro": 1000, "gs": 90, "track": 0, "seen_pos": 0}], 0.0)
    tr.ingest([{"hex": "new222", "lat": 33.1, "lon": -118.5, "alt_baro": 1000, "gs": 90, "track": 0, "seen_pos": 0}], 700.0)
    assert set(tr.info) == {"new222"}


def _spotter(hexid="a1b2c3", lat=33.42, lon=-118.48, reg="N123SP"):
    return {"hex": hexid, "reg": reg, "callsign": None, "lat": lat, "lon": lon, "alt_ft": 1180, "spotter": True, "circling": True,
            "circles": 4.0, "loiter_min": 12.0}


def _sub(uid="u1", center=(-118.45, 33.40), radius=15, state=None, label="Catalina"):
    return {"id": "s-" + uid, "user_id": uid, "kind": "spotter", "active": True,
            "params": {"center": list(center), "radius_nm": radius, "label": label}, "state": state or {}}


def test_spotter_alert_goes_to_people_whose_area_it_is_in():
    from datetime import datetime, timezone
    from air.alerts import decide
    now = datetime(2026, 10, 27, 19, 0, tzinfo=timezone.utc)
    out = decide([_sub("near"), _sub("far", center=(-117.2, 32.7))], [_spotter()], now, premium=False, pro_users=set())
    assert [s["user_id"] for s, *_ in out] == ["near"]
    s, p, text, state = out[0]
    assert "Catalina" in text and "N123SP" in text and "1,200 ft" in text and "4 circles" in text
    assert "a1b2c3" in state["sent"] and state["n"] == 1


def test_same_plane_not_repeated_and_daily_cap():
    from datetime import datetime, timedelta, timezone
    from air.alerts import PER_DAY, decide
    now = datetime(2026, 10, 27, 19, 0, tzinfo=timezone.utc)
    st = decide([_sub()], [_spotter()], now, False, set())[0][3]
    assert decide([_sub(state=st)], [_spotter()], now + timedelta(minutes=30), False, set()) == []          # same plane, too soon
    assert len(decide([_sub(state=st)], [_spotter()], now + timedelta(minutes=100), False, set())) == 1     # later: again
    full = {**st, "n": PER_DAY}
    assert decide([_sub(state=full)], [_spotter("other1")], now + timedelta(minutes=5), False, set()) == []


def test_pro_switch_limits_spotter_alerts_to_pro_members():
    from datetime import datetime, timezone
    from air.alerts import decide
    now = datetime(2026, 10, 27, 19, 0, tzinfo=timezone.utc)
    subs = [_sub("free"), _sub("paid")]
    assert {s["user_id"] for s, *_ in decide(subs, [_spotter()], now, premium=False, pro_users=set())} == {"free", "paid"}
    assert {s["user_id"] for s, *_ in decide(subs, [_spotter()], now, premium=True, pro_users={"paid"})} == {"paid"}
    assert decide(subs, [{**_spotter(), "spotter": False}], now, False, set()) == []                        # just circling high: no alert
