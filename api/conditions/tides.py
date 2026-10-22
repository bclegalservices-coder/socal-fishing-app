"""NOAA CO-OPS tides (spec §16). Predictions come from the nearest prediction station and
are labeled with the station and its distance — never presented as measured at the tapped point."""
from datetime import datetime, timedelta, timezone

from core.geo import distance_nm
from core.http import cached, client

STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json"
DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


@cached(7 * 24 * 3600)
async def stations() -> list[dict]:
    r = await client().get(STATIONS_URL, params={"type": "tidepredictions"})
    r.raise_for_status()
    out = []
    for s in r.json().get("stations", []):
        try:
            out.append({"id": str(s["id"]), "name": s.get("name"), "lat": float(s["lat"]), "lon": float(s["lng"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def nearest(sts: list[dict], lat: float, lon: float) -> tuple[dict | None, float | None]:
    best, bd = None, None
    for s in sts:
        d = distance_nm(lat, lon, s["lat"], s["lon"])
        if bd is None or d < bd:
            best, bd = s, d
    return best, bd


def _parse_t(t: str) -> datetime:
    return datetime.strptime(t, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


@cached(6 * 3600)
async def predictions(station: str, begin: str, end: str, interval: str) -> list[dict]:
    """interval 'hilo' for highs/lows, '6' or 'h' for a curve. Times in UTC."""
    r = await client().get(DATA_URL, params={
        "product": "predictions", "datum": "MLLW", "units": "english", "time_zone": "gmt",
        "format": "json", "application": "fishing_app", "station": station,
        "begin_date": begin, "end_date": end, "interval": interval,
    })
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"].get("message", "CO-OPS error"))
    return [{"t": _parse_t(p["t"]).isoformat(), "v": float(p["v"]), "type": p.get("type")} for p in j.get("predictions", [])]


def curve_from_hilo(hilo: list[dict], begin: datetime, end: datetime, step_min: int = 6) -> list[dict]:
    """Tide curve from the high/low times, using the standard cosine shape between each high and low.
    NOAA's "subordinate" stations only publish highs and lows, so this is how their curve is drawn."""
    pts = sorted((datetime.fromisoformat(p["t"]), p["v"]) for p in hilo)
    out, t = [], begin
    step = timedelta(minutes=step_min)
    import math
    k = 0
    while t <= end and len(pts) >= 2:
        while k < len(pts) - 2 and t > pts[k + 1][0]:
            k += 1
        (t1, h1), (t2, h2) = pts[k], pts[k + 1]
        if t1 <= t <= t2:
            f = (t - t1).total_seconds() / max(1.0, (t2 - t1).total_seconds())
            out.append({"t": t.isoformat(), "v": round((h1 + h2) / 2 + (h1 - h2) / 2 * math.cos(math.pi * f), 3), "type": None})
        t += step
    return out


async def _station_data(lat: float, lon: float, hilo_range: tuple[str, str], curve_range: tuple[str, str], interval: str,
                        curve_window: tuple[datetime, datetime], tries: int = 4) -> tuple[dict, float, list, list]:
    """Nearest station that answers. Highs/lows are required; when a station can't give a curve (subordinate
    stations), the curve is worked out from its highs and lows."""
    sts = await stations()
    ranked = sorted(sts, key=lambda s: distance_nm(lat, lon, s["lat"], s["lon"]))[:tries]
    last = None
    for st in ranked:
        try:
            hilo = await predictions(st["id"], *hilo_range, "hilo")
        except Exception as e:
            last = e
            continue
        if not hilo:
            continue
        try:
            curve = await predictions(st["id"], *curve_range, interval)
        except Exception:
            curve = []
        if not curve:
            curve = curve_from_hilo(hilo, *curve_window, step_min=6 if interval == "6" else 60)
        return st, distance_nm(lat, lon, st["lat"], st["lon"]), hilo, curve
    raise RuntimeError(f"No nearby NOAA tide station answered ({last})" if last else "No NOAA tide prediction station found")


def tide_state(curve: list[dict], now: datetime) -> dict:
    """Height now (linear interpolation) and rising/falling, from a 6-minute curve."""
    pts = [(datetime.fromisoformat(p["t"]), p["v"]) for p in curve]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t0 <= now <= t1:
            f = (now - t0).total_seconds() / max(1.0, (t1 - t0).total_seconds())
            return {"height_ft": round(v0 + (v1 - v0) * f, 2), "trend": "rising" if v1 > v0 else "falling" if v1 < v0 else "slack"}
    return {"height_ft": None, "trend": None}


async def tide_at(lat: float, lon: float, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    day = now.strftime("%Y%m%d")
    nxt = (now + timedelta(days=2)).strftime("%Y%m%d")
    prv = (now - timedelta(days=1)).strftime("%Y%m%d")
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    st, dist, hilo, curve = await _station_data(lat, lon, (prv, nxt), (day, (now + timedelta(days=1)).strftime("%Y%m%d")), "6",
                                                (start, start + timedelta(days=2) - timedelta(minutes=1)))
    state = tide_state(curve, now)
    upcoming = [p for p in hilo if datetime.fromisoformat(p["t"]) > now]
    next_high = next((p for p in upcoming if p["type"] == "H"), None)
    next_low = next((p for p in upcoming if p["type"] == "L"), None)
    return {"station": st, "distance_nm": round(dist, 1), "state": state, "next_high": next_high,
            "next_low": next_low, "hilo": hilo, "curve": curve[::5]}  # 30-min points for the chart


MAX_RANGE_DAYS = 31


@cached(30 * 60)
async def observed(station: str, begin: str, end: str) -> list[dict]:
    """MEASURED water level (hourly) — only stations with a tide gauge have it; others return []."""
    r = await client().get(DATA_URL, params={
        "product": "hourly_height", "datum": "MLLW", "units": "english", "time_zone": "gmt",
        "format": "json", "application": "fishing_app", "station": station,
        "begin_date": begin, "end_date": end,
    })
    if r.status_code != 200:
        return []
    j = r.json()
    if "error" in j:
        return []
    out = []
    for p in j.get("data", []):
        try:
            out.append({"t": _parse_t(p["t"]).isoformat(), "v": float(p["v"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def clamp_range(begin: datetime, end: datetime) -> tuple[datetime, datetime]:
    if end < begin:
        begin, end = end, begin
    if (end - begin).days > MAX_RANGE_DAYS:
        end = begin + timedelta(days=MAX_RANGE_DAYS)
    return begin, end


async def tide_range(lat: float, lon: float, begin: datetime, end: datetime, now: datetime | None = None) -> dict:
    """Tides for any past or future dates (max 31 days): predicted highs/lows + hourly curve, and for
    past dates the measured water level when the nearest station has a gauge."""
    now = now or datetime.now(timezone.utc)
    begin, end = clamp_range(begin, end)
    b, e = begin.strftime("%Y%m%d"), end.strftime("%Y%m%d")
    b0 = begin.replace(hour=0, minute=0, second=0, microsecond=0)
    e1 = end.replace(hour=23, minute=59, second=0, microsecond=0)
    # one extra day each side of the highs/lows so the worked-out curve covers the whole range
    st, dist, hilo, curve = await _station_data(lat, lon, ((begin - timedelta(days=1)).strftime("%Y%m%d"), (end + timedelta(days=1)).strftime("%Y%m%d")),
                                                (b, e), "h", (b0, e1))
    hilo = [p for p in hilo if b0 <= datetime.fromisoformat(p["t"]) <= e1]
    obs = []
    if begin < now:
        obs = await observed(st["id"], b, min(end, now).strftime("%Y%m%d"))
    return {"station": st, "distance_nm": round(dist, 1), "begin": b, "end": e,
            "hilo": hilo, "curve": curve, "observed": obs,
            "note": "Predicted tides are from the nearest NOAA station; 'observed' is the measured water level."}
