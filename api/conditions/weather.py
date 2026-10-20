"""National Weather Service API (spec §18-19). /points -> gridpoint forecast data.
Offshore points outside NWS grids return 404; the caller falls back to buoys."""
import re
from datetime import datetime, timedelta, timezone

from core.http import cached, client

NWS = "https://api.weather.gov"
_DUR = re.compile(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?")


def parse_valid_time(s: str) -> tuple[datetime, datetime]:
    start_s, dur_s = s.split("/")
    start = datetime.fromisoformat(start_s).astimezone(timezone.utc)
    m = _DUR.fullmatch(dur_s)
    d = timedelta(days=int(m.group(1) or 0), hours=int(m.group(2) or 0), minutes=int(m.group(3) or 0)) if m else timedelta(hours=1)
    return start, start + d


def value_at(prop: dict | None, when: datetime):
    """Value of an NWS gridData property valid at `when` -> (value, uom, valid_start) or (None, uom, None)."""
    if not prop:
        return None, None, None
    uom = prop.get("uom")
    for v in prop.get("values", []):
        a, b = parse_valid_time(v["validTime"])
        if a <= when < b:
            return v["value"], uom, a
    return None, uom, None


def series(prop: dict | None, start: datetime, hours: int) -> list[tuple[datetime, float]]:
    if not prop:
        return []
    out = []
    for v in prop.get("values", []):
        a, b = parse_valid_time(v["validTime"])
        t = max(a, start)
        while t < b and t < start + timedelta(hours=hours):
            if v["value"] is not None:
                out.append((t, v["value"]))
            t += timedelta(hours=1)
    return out


def to_knots(v, uom):
    if v is None:
        return None
    if uom and "km_h" in uom:
        return v * 0.539957
    if uom and "m_s" in uom:
        return v * 1.943844
    return v


def to_feet(v, uom):
    return None if v is None else (v * 3.28084 if uom and uom.endswith(":m") else v)


def to_f(v, uom):
    return None if v is None else (v * 9 / 5 + 32 if uom and "degC" in uom else v)


@cached(24 * 3600)
async def point_meta(lat: float, lon: float) -> dict | None:
    r = await client().get(f"{NWS}/points/{lat:.4f},{lon:.4f}")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()["properties"]


@cached(30 * 60)
async def grid_data(url: str) -> dict:
    r = await client().get(url)
    r.raise_for_status()
    return r.json()["properties"]


@cached(5 * 60)
async def alerts(lat: float, lon: float) -> list[dict]:
    r = await client().get(f"{NWS}/alerts/active", params={"point": f"{lat:.4f},{lon:.4f}"})
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        p = f["properties"]
        out.append({"event": p.get("event"), "headline": p.get("headline"), "severity": p.get("severity"),
                    "onset": p.get("onset"), "ends": p.get("ends") or p.get("expires"), "area": p.get("areaDesc")})
    return out


async def weather_at(lat: float, lon: float, now: datetime | None = None) -> dict | None:
    now = now or datetime.now(timezone.utc)
    meta = await point_meta(round(lat, 4), round(lon, 4))
    if not meta or not meta.get("forecastGridData"):
        return None
    g = await grid_data(meta["forecastGridData"])
    out = {"office": meta.get("gridId"), "updated": g.get("updateTime")}
    for key, prop, conv in (("wind_kt", "windSpeed", to_knots), ("gust_kt", "windGust", to_knots),
                            ("wave_ft", "waveHeight", to_feet), ("air_f", "temperature", to_f)):
        v, uom, _ = value_at(g.get(prop), now)
        out[key] = None if v is None else round(conv(v, uom), 1)
    wd, _, _ = value_at(g.get("windDirection"), now)
    out["wind_dir"] = wd
    vis, vuom, _ = value_at(g.get("visibility"), now)
    out["visibility_nm"] = None if vis is None else round(vis / 1852 if vuom and vuom.endswith(":m") else vis, 1)
    pop, _, _ = value_at(g.get("probabilityOfPrecipitation"), now)
    out["precip_chance"] = pop
    wx, _, _ = value_at(g.get("weather"), now)
    if isinstance(wx, list) and wx:
        w = wx[0] or {}
        out["conditions"] = " ".join(x for x in (w.get("intensity"), w.get("weather")) if x) or None
    out["wind_48h"] = [{"t": t.isoformat(), "kt": round(to_knots(v, g.get("windSpeed", {}).get("uom")), 1)}
                       for t, v in series(g.get("windSpeed"), now, 48)]
    return out
