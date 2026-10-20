from seas.rating import (best_window, boat_limits, nws_sca_by_seas, rate, relative_direction, rule_2x,
                         steepness_class, summarize_day, combined_seas)


def test_nws_examples():
    # WR TA 03-11: 7 ft @ 7 s is "very steep"; 20 ft @ 20 s is not steep.
    assert steepness_class(7, 7) == "very_steep"
    assert steepness_class(20, 20) in ("gentle", "moderate")
    assert steepness_class(3, None) == "unknown"


def test_wr_sca_rule():
    assert not nws_sca_by_seas(4.5, 4)        # under 5 ft never hazardous by seas alone
    assert nws_sca_by_seas(7, 7)              # steep 5-18 ft
    assert not nws_sca_by_seas(8, 16)         # long-period 8 ft is not steep
    assert nws_sca_by_seas(18, 20)            # 18 ft+ always


def test_nice_day():
    r = rate({"seas_ft": 2, "period_s": 14, "wind_kt": 6, "gust_kt": 9}, {"type": "center_console", "length_ft": 23})
    assert r["level"] == "comfortable", r
    assert r["rule_2x"]["passes"]


def test_short_period_worse():
    boat = {"type": "center_console", "length_ft": 23}
    long_ = rate({"seas_ft": 3.5, "period_s": 15, "wind_kt": 8}, boat)
    short = rate({"seas_ft": 3.5, "period_s": 5, "wind_kt": 8}, boat)
    assert short["score"] > long_["score"]
    assert not rule_2x(3.5, 5)["passes"]


def test_sca_small_vs_big():
    hour = {"seas_ft": 3, "period_s": 12, "wind_kt": 23, "gust_kt": 28}
    assert rate(hour, {"type": "skiff"})["level"] == "stay_in"
    big = rate(hour, {"type": "sportfisher", "length_ft": 40})
    assert big["level"] in ("rough", "stay_in") and big["sca_conditions"]


def test_warnings_override():
    calm = {"seas_ft": 1, "period_s": 12, "wind_kt": 4}
    assert rate(calm, {"type": "sportfisher"}, ["Gale Warning"])["level"] == "stay_in"
    r = rate(calm, {"type": "center_console"}, ["High Surf Advisory"])
    assert r["level"] == "comfortable" and any("harbor" in x for x in r["reasons"])


def test_boat_size_and_comfort():
    assert boat_limits({"type": "center_console", "length_ft": 33})["seas_ft"] > boat_limits({"type": "center_console", "length_ft": 20})["seas_ft"]
    hour = {"seas_ft": 3.5, "period_s": 9, "wind_kt": 12}
    easy = rate(hour, {"type": "center_console", "comfort": "easygoing"})
    pro = rate(hour, {"type": "center_console", "comfort": "experienced"})
    assert easy["score"] > pro["score"]


def test_direction():
    assert relative_direction(270, 270) == "head"
    assert relative_direction(270, 90) == "following"
    assert relative_direction(0, 90) == "beam"
    hour = {"seas_ft": 3, "period_s": 10, "wind_kt": 8, "waves_from_deg": 270}
    beam = rate(hour, {"type": "bay", "course_deg": 180})
    head = rate(hour, {"type": "bay", "course_deg": 270})
    assert beam["score"] > head["score"]


def test_window_and_summary():
    seq = []
    for i, (h, w) in enumerate([(2, 5), (2, 6), (2, 7), (3, 15), (5, 24)]):
        seq.append({"t": f"2026-10-10T{12 + i:02d}:00:00+00:00",
                    "rating": rate({"seas_ft": h, "period_s": 13, "wind_kt": w}, {"type": "center_console"})})
    win = best_window(seq)
    assert win and win["start"].startswith("2026-10-10T12") and win["hours"] >= 3
    day = summarize_day(seq)
    assert day["level"] == "stay_in" and day["best_level"] == "comfortable"
    assert combined_seas(3, 4) == 5.0


def _grid():
    return {
        "updateTime": "2026-10-10T10:00:00+00:00",
        "windSpeed": {"uom": "wmoUnit:km_h-1", "values": [
            {"validTime": "2026-10-10T12:00:00+00:00/PT6H", "value": 11.1},    # 6 kt
            {"validTime": "2026-10-10T18:00:00+00:00/PT18H", "value": 44.4}]},  # 24 kt
        "windDirection": {"uom": "wmoUnit:degree_(angle)", "values": [{"validTime": "2026-10-10T12:00:00+00:00/P1D", "value": 290}]},
        "waveHeight": {"uom": "wmoUnit:m", "values": [{"validTime": "2026-10-10T12:00:00+00:00/P1D", "value": 0.9}]},
        "wavePeriod": {"uom": "wmoUnit:s", "values": [{"validTime": "2026-10-10T12:00:00+00:00/P1D", "value": 13}]},
        "primarySwellHeight": {"uom": "wmoUnit:m", "values": [{"validTime": "2026-10-10T12:00:00+00:00/P1D", "value": 0.9}]},
        "primarySwellDirection": {"values": [{"validTime": "2026-10-10T12:00:00+00:00/P1D", "value": 260}]},
        "temperature": {"uom": "wmoUnit:degC", "values": [{"validTime": "2026-10-10T12:00:00+00:00/P1D", "value": 20}]},
        "weather": {"values": [{"validTime": "2026-10-10T12:00:00+00:00/PT3H",
                                "value": [{"coverage": "patchy", "weather": "fog", "intensity": None}]}]},
    }


def test_forecast_build():
    from datetime import datetime, timezone
    from seas.forecast import build
    now = datetime(2026, 10, 10, 12, 20, tzinfo=timezone.utc)
    alerts = [{"event": "Small Craft Advisory", "onset": "2026-10-10T21:00:00+00:00", "ends": "2026-10-11T06:00:00+00:00"}]
    out = build(_grid(), alerts, {"type": "center_console", "length_ft": 23}, 33.6, -117.9, now=now, days=1)
    h = out["hourly"]
    assert len(h) == 24 and h[0]["t"].startswith("2026-10-10T12:00")
    assert h[0]["wind_kt"] == 6.0 and h[0]["seas_ft"] == 3.0 and h[0]["air_f"] == 68.0
    assert h[0]["weather"] == "patchy fog" and "weather" not in h[5]
    assert h[0]["rating"]["level"] == "comfortable"
    assert h[9]["rating"]["level"] in ("rough", "stay_in")       # 21Z: 24 kt + SCA in effect
    assert any("Small Craft Advisory" in r for r in h[9]["rating"]["reasons"])
    assert out["daily"][0]["summary"]["window"]["start"].startswith("2026-10-10T12")
    assert out["daily"][0]["sunrise"] and out["has_marine"]


def test_wind_chop_period_estimated():
    from seas.forecast import seas_for_rating
    s = seas_for_rating({"wave_ft": 4, "swell_ft": 2, "swell_period_s": 14, "wind_wave_ft": 3.5, "wind_dir": 300, "wind_kt": 18})
    assert s["period_estimated"] and s["period_s"] < 6 and s["waves_from_deg"] == 300
    s2 = seas_for_rating({"wave_ft": 4, "swell_ft": 2, "wind_wave_ft": 3.5, "wind_wave_period_s": 5, "wind_dir": 300})
    assert s2["period_s"] == 5 and not s2["period_estimated"]


CWF = """FZUS56 KLOX 101000
CWFLOX

Coastal Waters Forecast for Southern California
National Weather Service Los Angeles/Oxnard CA

PZZ650-655-101800-
East Santa Barbara Channel from Pt. Conception to Pt. Mugu CA
including Santa Cruz Island-
Inner waters from Point Mugu to San Mateo Pt. CA including Santa
Catalina and Anacapa Islands-
300 AM PDT Sat Oct 10 2026

...SMALL CRAFT ADVISORY IN EFFECT FROM 2 PM THIS AFTERNOON...

.TODAY...W winds 10 to 15 kt, increasing to 15 to 25 kt this
afternoon. Wind waves 2 to 4 ft. W swell 3 ft at 11 seconds.
.TONIGHT...W winds 15 to 20 kt. Wind waves 3 ft.
$$

PZZ670>673-101800-
Point Piedras Blancas to Point Sal 10 to 60 NM offshore-
300 AM PDT Sat Oct 10 2026

.TODAY...NW winds 20 to 30 kt.
$$
"""


def test_zone_parse():
    from seas.zone import parse_cwf, parse_ugc
    assert parse_ugc("PZZ650-655-101800-") == ["PZZ650", "PZZ655"]
    assert parse_ugc("PZZ670>673-101800-") == ["PZZ670", "PZZ671", "PZZ672", "PZZ673"]
    z = parse_cwf(CWF, "PZZ655")
    assert z and "Inner waters" in z["name"]
    assert z["headlines"] == ["Small craft advisory in effect from 2 pm this afternoon"]
    assert [p["name"] for p in z["periods"]] == ["Today", "Tonight"]
    assert "11 seconds" in z["periods"][0]["text"]
    assert parse_cwf(CWF, "PZZ672")["periods"][0]["text"].startswith("NW winds")
    assert parse_cwf(CWF, "PZZ999") is None


def test_buoy_history_hourly():
    from conditions.buoys import parse_history
    txt = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC
2026 10 10 14 40 280  5.0  7.0   1.2    13   7.1 270 1015.1  17.2  19.4
2026 10 10 14 10 280  4.0  6.0   1.1    13   7.0 270 1015.1  17.1  19.4
2026 10 10 13 40 270  3.0  MM    MM     MM   MM   MM 1015.0  17.0  19.3
"""
    rows = parse_history(txt)
    assert [r["t"][11:13] for r in rows] == ["13", "14"]
    assert rows[1]["wind_kt"] == 9.7 and rows[0]["wave_ft"] is None and rows[1]["pressure_mb"] == 1015.1


def test_weather_endpoint_glue():
    """Calls the /weather and /tides/range handlers with fake data sources (no network)."""
    import asyncio
    import sys
    import types
    if "fastapi" not in sys.modules:
        try:
            import fastapi  # noqa: F401
        except ImportError:
            fa = types.ModuleType("fastapi")

            class APIRouter:
                def get(self, *a, **k):
                    return lambda f: f
            class HTTPException(Exception):
                def __init__(self, code, detail=""):
                    super().__init__(detail); self.status_code = code
            fa.APIRouter, fa.HTTPException, fa.Query = APIRouter, HTTPException, lambda d=None, **k: d
            sys.modules["fastapi"] = fa
    from seas import routes as r
    from seas import forecast as fc

    async def point_meta(lat, lon):
        return {"forecastGridData": "grid", "gridId": "LOX", "relativeLocation": {"properties": {"city": "Newport Beach", "state": "CA"}}}
    async def grid_data(url):
        return _grid()
    async def alerts(lat, lon):
        return [{"event": "Small Craft Advisory", "onset": None, "ends": None}]
    async def zone_forecast(lat, lon):
        return {"zone": "PZZ655", "name": "Inner waters", "headlines": [], "periods": []}
    async def nearest_observation(*a, **k):
        return {"station": {"id": "46222"}, "wave_ft": 3.0}
    async def tide_at(lat, lon):
        raise RuntimeError("offline")  # one source failing must not break the page
    orig = (fc.weather.point_meta, fc.weather.grid_data, fc.weather.alerts, r.zone.zone_forecast, r.buoys.nearest_observation, r.tides.tide_at)
    fc.weather.point_meta, fc.weather.grid_data, fc.weather.alerts = point_meta, grid_data, alerts
    r.zone.zone_forecast, r.buoys.nearest_observation, r.tides.tide_at = zone_forecast, nearest_observation, tide_at
    try:
        out = asyncio.run(r.weather_page(lat=33.585, lon=-117.885, days=2, boat_type="skiff", boat_len=16, comfort="normal", course=None))
    finally:
        fc.weather.point_meta, fc.weather.grid_data, fc.weather.alerts, r.zone.zone_forecast, r.buoys.nearest_observation, r.tides.tide_at = orig
    f = out["forecast"]
    assert f["available"] and f["place"] == "Newport Beach, CA" and len(f["hourly"]) == 48
    assert all(h["rating"]["level"] == "stay_in" for h in f["hourly"] if h.get("wind_kt"))  # skiff under an SCA
    assert out["tide"] is None and out["zone"]["zone"] == "PZZ655" and out["buoy_now"]["station"]["id"] == "46222"
    assert out["boat"]["type"] == "skiff" and "guidance" in out["disclaimer"]
