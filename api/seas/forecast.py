"""Weather page: 5-day hourly marine forecast for any point, every hour rated for the user's boat.

Source: NWS gridpoint forecast (api.weather.gov) — the same numbers behind the official forecasts.
NWS marine grids reach roughly 60 NM offshore in SoCal; beyond that the page shows the nearest
buoy's measurements and the marine zone text instead (labeled as such).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from conditions import weather
from conditions.astro import moon_phase, sun_times
from seas.rating import BOAT_TYPES, COMFORT, combined_seas, rate, summarize_day

LOCAL = ZoneInfo("America/Los_Angeles")
FISHING_HOURS = range(4, 20)  # 4am-7pm local decides a day's color

# NWS gridData property -> (our key, converter)
PROPS = {
    "windSpeed": ("wind_kt", weather.to_knots),
    "windGust": ("gust_kt", weather.to_knots),
    "windDirection": ("wind_dir", None),
    "waveHeight": ("wave_ft", weather.to_feet),
    "wavePeriod": ("swell_period_s", None),
    "waveDirection": ("wave_dir", None),
    "primarySwellHeight": ("swell_ft", weather.to_feet),
    "primarySwellDirection": ("swell_dir", None),
    "secondarySwellHeight": ("swell2_ft", weather.to_feet),
    "secondarySwellDirection": ("swell2_dir", None),
    "wavePeriod2": ("swell2_period_s", None),
    "windWaveHeight": ("wind_wave_ft", weather.to_feet),
    "windWavePeriod": ("wind_wave_period_s", None),  # not every office publishes this
    "temperature": ("air_f", weather.to_f),
    "skyCover": ("sky_pct", None),
    "probabilityOfPrecipitation": ("precip_pct", None),
    "visibility": ("visibility_nm", lambda v, u: v / 1852 if u and u.endswith(":m") else v),
}


def floor_hour(t: datetime) -> datetime:
    return t.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def hourly_rows(grid: dict, start: datetime, hours: int) -> list[dict]:
    """Flatten NWS gridData (values with ISO-8601 intervals) into one row per hour."""
    rows = {start + timedelta(hours=i): {} for i in range(hours)}
    for prop, (key, conv) in PROPS.items():
        p = grid.get(prop)
        if not p:
            continue
        uom = p.get("uom")
        for t, v in weather.series(p, start, hours):
            if t in rows and v is not None:
                rows[t][key] = round(conv(v, uom), 1) if conv else v
    wx = grid.get("weather") or {}
    for v in wx.get("values", []):
        a, b = weather.parse_valid_time(v["validTime"])
        items = [w for w in (v.get("value") or []) if w and w.get("weather")]
        if not items:
            continue
        text = ", ".join(" ".join(x for x in (w.get("coverage"), w.get("intensity"), w.get("weather")) if x).replace("_", " ")
                         for w in items[:2])
        t = max(floor_hour(a), start)
        while t < b and t in rows:
            rows[t]["weather"] = text
            t += timedelta(hours=1)
    return [{"t": t.isoformat(), **r} for t, r in sorted(rows.items())]


def seas_for_rating(row: dict) -> dict:
    """Pick the height, period and direction that matter for comfort.  NWS 'waveHeight' is already
    the combined sea; if wind waves dominate, their period is short (estimated, and flagged)."""
    seas = row.get("wave_ft") or combined_seas(row.get("swell_ft"), row.get("swell2_ft"), row.get("wind_wave_ft"))
    swell, ww = row.get("swell_ft") or 0, row.get("wind_wave_ft") or 0
    period, frm, est = row.get("swell_period_s"), row.get("swell_dir") or row.get("wave_dir"), False
    if ww and ww >= swell:
        if row.get("wind_wave_period_s"):
            period, est = row["wind_wave_period_s"], False
        else:
            period, est = round(max(3.0, 4.0 * math.sqrt(ww * 0.3048)), 1), True  # local wind chop: ~3-5 s
        frm = row.get("wind_dir")
    return {"seas_ft": seas, "period_s": period, "wind_kt": row.get("wind_kt"), "gust_kt": row.get("gust_kt"),
            "waves_from_deg": frm, "period_estimated": est}


def active_at(alerts: list[dict], t: datetime) -> list[str]:
    out = []
    for a in alerts:
        on = datetime.fromisoformat(a["onset"]) if a.get("onset") else None
        end = datetime.fromisoformat(a["ends"]) if a.get("ends") else None
        if (on is None or on <= t) and (end is None or t < end) and a.get("event"):
            out.append(a["event"])
    return out


def build(grid: dict, alerts: list[dict], boat: dict, lat: float, lon: float,
          now: datetime | None = None, days: int = 5) -> dict:
    start = floor_hour(now or datetime.now(timezone.utc))
    rows = hourly_rows(grid, start, days * 24)
    for r in rows:
        t = datetime.fromisoformat(r["t"])
        s = seas_for_rating(r)
        r["seas_ft"], r["period_s"], r["period_estimated"] = s["seas_ft"], s["period_s"], s["period_estimated"]
        r["rating"] = rate(s, boat, active_at(alerts, t))
    by_day: dict[str, list[dict]] = {}
    for r in rows:
        by_day.setdefault(datetime.fromisoformat(r["t"]).astimezone(LOCAL).date().isoformat(), []).append(r)
    daily = []
    for d, rs in by_day.items():
        day_hours = [r for r in rs if datetime.fromisoformat(r["t"]).astimezone(LOCAL).hour in FISHING_HOURS] or rs
        num = lambda k: [r[k] for r in rs if r.get(k) is not None]  # noqa: E731
        date_ = datetime.fromisoformat(d).date()
        sun = sun_times(lat, lon, date_)
        noon = datetime.combine(date_, datetime.min.time(), LOCAL).replace(hour=12)
        daily.append({
            "date": d, "summary": summarize_day(day_hours),
            "wind_kt_max": max(num("wind_kt"), default=None), "gust_kt_max": max(num("gust_kt"), default=None),
            "seas_ft_max": max(num("seas_ft"), default=None), "seas_ft_min": min(num("seas_ft"), default=None),
            "air_f_hi": max(num("air_f"), default=None), "air_f_lo": min(num("air_f"), default=None),
            "precip_pct_max": max(num("precip_pct"), default=None),
            "sunrise": sun["sunrise"].isoformat() if sun["sunrise"] else None,
            "sunset": sun["sunset"].isoformat() if sun["sunset"] else None,
            "moon": moon_phase(noon.astimezone(timezone.utc)),
        })
    has_marine = any(r.get("seas_ft") is not None for r in rows)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "updated": grid.get("updateTime"),
            "has_marine": has_marine, "hourly": rows, "daily": daily}


def boat_from_query(boat_type: str | None, length: float | None, comfort: str | None, course: float | None) -> dict:
    return {"type": boat_type if boat_type in BOAT_TYPES else "center_console",
            "length_ft": length, "comfort": comfort if comfort in COMFORT else "normal", "course_deg": course}


async def forecast(lat: float, lon: float, boat: dict, days: int = 5) -> dict:
    meta = await weather.point_meta(round(lat, 4), round(lon, 4))
    alerts = []
    try:
        alerts = await weather.alerts(lat, lon)
    except Exception:  # alerts are a bonus; never fail the page over them
        pass
    if not meta or not meta.get("forecastGridData"):
        return {"available": False, "alerts": alerts,
                "note": "This point is outside the NWS forecast grid (usually 60+ NM offshore). "
                        "Showing the nearest buoy and the marine zone forecast instead."}
    grid = await weather.grid_data(meta["forecastGridData"])
    out = build(grid, alerts, boat, lat, lon, days=days)
    town = (meta.get("relativeLocation") or {}).get("properties") or {}
    return {"available": True, "office": meta.get("gridId"),
            "place": ", ".join(x for x in (town.get("city"), town.get("state")) if x) or None,
            "alerts": alerts, **out}
