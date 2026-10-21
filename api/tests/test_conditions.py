from datetime import datetime, timedelta, timezone

from conditions import buoys, tides, weather
from conditions.astro import moon_phase

BUOY_TXT = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 10 03 15 40 280  5.0  7.0   1.2    13   7.1 270 1015.1  17.2  19.4    MM   MM   MM    MM
2026 10 03 15 30 280  4.0  6.0   1.1    13   7.0 270 1015.1  17.1  19.4    MM   MM   MM    MM
"""

ACTIVE_XML = """<stations>
<station id="46222" lat="33.618" lon="-118.317" name="San Pedro" owner="SCRIPPS" met="y" />
<station id="51000" lat="23.5" lon="-153.8" name="Far away" met="y" />
<station id="X1" lat="33.5" lon="-118.0" name="No met" met="n" />
</stations>"""


def test_buoy_parse_units():
    o = buoys.parse_realtime(BUOY_TXT)
    assert o["wind_kt"] == 9.7 and o["gust_kt"] == 13.6
    assert o["wave_ft"] == 3.9 and o["dominant_period_s"] == 13
    assert o["water_f"] == 66.9
    assert o["observed_at"].startswith("2026-10-03T15:40")


def test_buoy_station_filter():
    s = buoys.parse_active(ACTIVE_XML, (-121, 31, -116.6, 35))
    assert [x["id"] for x in s] == ["46222"]


def test_nws_interval_parsing():
    a, b = weather.parse_valid_time("2026-10-03T12:00:00+00:00/PT3H")
    assert (b - a) == timedelta(hours=3)
    a, b = weather.parse_valid_time("2026-10-03T00:00:00+00:00/P1DT6H")
    assert (b - a) == timedelta(days=1, hours=6)


def test_nws_value_at_and_units():
    prop = {"uom": "wmoUnit:km_h-1", "values": [
        {"validTime": "2026-10-03T12:00:00+00:00/PT2H", "value": 18.52},
        {"validTime": "2026-10-03T14:00:00+00:00/PT1H", "value": 37.04}]}
    v, uom, _ = weather.value_at(prop, datetime(2026, 10, 3, 13, 30, tzinfo=timezone.utc))
    assert abs(weather.to_knots(v, uom) - 10.0) < 0.01
    v, _, _ = weather.value_at(prop, datetime(2026, 10, 3, 16, tzinfo=timezone.utc))
    assert v is None
    assert abs(weather.to_feet(1.0, "wmoUnit:m") - 3.28084) < 1e-6
    assert weather.to_f(20, "wmoUnit:degC") == 68


def test_tide_state_rising_and_falling():
    t0 = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
    curve = [{"t": (t0 + timedelta(minutes=6 * i)).isoformat(), "v": v} for i, v in enumerate([1.0, 1.2, 1.4, 1.3])]
    s = tides.tide_state(curve, t0 + timedelta(minutes=3))
    assert s["trend"] == "rising" and abs(s["height_ft"] - 1.1) < 1e-6
    s = tides.tide_state(curve, t0 + timedelta(minutes=15))
    assert s["trend"] == "falling"


def test_nearest_station():
    sts = [{"id": "A", "lat": 33.7, "lon": -118.2}, {"id": "B", "lat": 32.7, "lon": -117.2}]
    st, d = tides.nearest(sts, 33.6, -118.1)
    assert st["id"] == "A" and d < 10


def test_moon_phase_known_full_moon():
    # Full moon: 2026-10-26 ~04:12 UTC
    m = moon_phase(datetime(2026, 10, 26, 4, tzinfo=timezone.utc))
    assert m["name"] == "Full moon" and m["illumination"] > 0.97


def test_snapshot_picks_image_on_or_before_day():
    import json, os, tempfile
    import numpy as np
    from core import storage
    from ocean.grid import Grid
    d = tempfile.mkdtemp()
    os.environ["LOCAL_DATA_DIR"] = d
    old_storage = os.environ.get("STORAGE")
    os.environ["STORAGE"] = "local"   # never the real R2 bucket
    storage._store = None
    st = storage.get_store()
    g = Grid(np.array([33.0, 34.0]), np.array([-119.0, -118.0]), np.full((2, 2), 66.0, np.float32), {"observed_at": "2026-10-01T09:00:00+00:00"})
    st.put("grids/sst/socal/2026-10-01.npz", g.to_bytes())
    st.put("manifests/sst.json", json.dumps({"dates": [{"date": "2026-10-03", "grid": "missing"}, {"date": "2026-10-01", "grid": "grids/sst/socal/2026-10-01.npz"}]}).encode())
    from conditions.snapshot import grid_for_day
    assert grid_for_day("sst", "2026-10-02") is not None        # uses Oct 1 for a catch on Oct 2
    assert grid_for_day("sst", "2026-09-30") is None             # nothing on or before
    # (a day with no image within 3 days returns None)
    if old_storage is None:
        os.environ.pop("STORAGE", None)
    else:
        os.environ["STORAGE"] = old_storage
    storage._store = None
