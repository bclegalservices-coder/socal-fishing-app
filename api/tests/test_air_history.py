import math

from air.history import EXIT_S, GRACE_S, Recorder, center, public


def _loops(t0, lat=33.30, lon=-118.60, n=60, r=0.012, start_angle=0.0):
    """One point every 10 s flying circles (about 1.4 NM across, a loop every ~2 min)."""
    out = []
    for i in range(n):
        a = start_angle + i * (2 * math.pi / 12)
        out.append((t0 + i * 10, lat + r * math.sin(a), lon + r / 0.835 * math.cos(a), 1200.0, 95.0, (math.degrees(a) + 90) % 360))
    return out


def _approach(t0, n=30):
    """Flying in from the north, 10 s apart."""
    return [(t0 + i * 10, 33.60 - i * 0.009, -118.60, 1500.0, 120.0, 180.0) for i in range(n)]


def _plane(lat, lon, spotter=True, circles=3.0):
    return {"hex": "a1b2c3", "reg": "N481SP", "type": "C172", "desc": "CESSNA 172", "owner": "SKY SPOTTERS LLC", "year": "1978",
            "callsign": None, "lat": lat, "lon": lon, "spotter": spotter, "circles": circles}


def test_records_the_real_path_including_the_approach():
    rec = Recorder()
    path = _approach(0) + _loops(300)
    now = path[-1][0]
    rec.observe([_plane(path[-1][1], path[-1][2])], {"a1b2c3": path}, now)
    (s,) = rec.recent(12, now)
    assert s["reg"] == "N481SP" and s["desc"] == "CESSNA 172" and s["active"]
    assert len(s["points"]) >= 60                               # 12 min lead-in: approach leg + the loops
    assert s["points"][0][1] > 33.4                             # starts up north, where it came from
    c = s["center"]
    assert abs(c[1] - 33.30) < 0.01 and abs(c[0] + 118.60) < 0.01   # the loops' middle, not the approach


def test_keeps_adding_while_it_works_then_closes_with_a_short_exit():
    rec = Recorder()
    path = _loops(0, n=60)
    rec.observe([_plane(33.3, -118.6)], {"a1b2c3": path}, 590)
    more = path + _loops(600, n=60, start_angle=0.3)
    rec.observe([_plane(33.3, -118.6)], {"a1b2c3": more}, 1190)
    leave = more + [(1200 + i * 10, 33.3 - i * 0.01, -118.6, 2000.0, 140.0, 180.0) for i in range(80)]
    rec.observe([_plane(33.2, -118.6, spotter=False)], {"a1b2c3": leave}, 1190 + GRACE_S + 30)
    (s,) = rec.recent(12, 1190 + GRACE_S + 30)
    assert not s["active"]
    assert s["points"][-1][2] <= 1190 + EXIT_S                  # only ~2 min of the flight away is kept
    assert s["minutes"] >= 15                                   # ~20 min working the spot


def test_same_plane_back_on_the_same_spot_is_one_session():
    rec = Recorder()
    p1 = _loops(0, n=40)
    rec.observe([_plane(33.3, -118.6)], {"a1b2c3": p1}, 390)
    rec.observe([], {"a1b2c3": p1}, 390 + GRACE_S + 20)       # stops / out of range → closed
    p2 = _loops(800, n=40)                                      # back 7 min later over the same spot
    rec.observe([_plane(33.3, -118.6)], {"a1b2c3": p2}, 1190)
    assert len(rec.recent(12, 1190)) == 1
    p3 = _loops(1700, lat=33.6, n=40)                           # later, a different spot far away → new session
    rec.observe([], {"a1b2c3": p2}, 1190 + GRACE_S + 20)
    rec.observe([_plane(33.6, -118.6)], {"a1b2c3": p3}, 2090)
    assert len(rec.recent(12, 2090)) == 2


def test_window_and_restart():
    rec = Recorder()
    rec.observe([_plane(33.3, -118.6)], {"a1b2c3": _loops(0)}, 590)
    assert rec.recent(12, 590 + 11 * 3600) and not rec.recent(12, 590 + 13 * 3600)
    rows = [dict(s) for s in rec.sessions.values()]
    rec2 = Recorder(); rec2.load(rows)
    assert len(rec2.recent(12, 600)) == 1 and not rec2.recent(12, 600)[0]["active"]
