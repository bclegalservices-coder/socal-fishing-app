"""NOAA National Data Buoy Center — MEASURED wind, waves and water temp (spec §20).
Always labeled 'observed', separate from forecasts."""
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from core.geo import distance_nm
from core.http import cached, client

ACTIVE = "https://www.ndbc.noaa.gov/activestations.xml"
REALTIME = "https://www.ndbc.noaa.gov/data/realtime2/{id}.txt"


def parse_active(xml_text: str, bbox: tuple) -> list[dict]:
    lon_min, lat_min, lon_max, lat_max = bbox
    out = []
    for s in ET.fromstring(xml_text).iter("station"):
        try:
            lat, lon = float(s.get("lat")), float(s.get("lon"))
        except (TypeError, ValueError):
            continue
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max and s.get("met") == "y":
            out.append({"id": s.get("id"), "name": s.get("name"), "lat": lat, "lon": lon, "owner": s.get("owner")})
    return out


def _num(x: str):
    return None if x in ("MM", "", None) else float(x)


def parse_realtime(text: str) -> dict | None:
    """First data row of a realtime2 .txt file (newest first)."""
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 3:
        return None
    hdr = lines[0].lstrip("#").split()
    row = lines[2].split()
    rec = dict(zip(hdr, row))
    t = datetime(int(rec["YY"]), int(rec["MM"]), int(rec["DD"]), int(rec["hh"]), int(rec["mm"]), tzinfo=timezone.utc)
    w = _num(rec.get("WSPD")); g = _num(rec.get("GST")); h = _num(rec.get("WVHT"))
    wt = _num(rec.get("WTMP")); at = _num(rec.get("ATMP"))
    return {
        "observed_at": t.isoformat(),
        "wind_kt": None if w is None else round(w * 1.943844, 1),
        "gust_kt": None if g is None else round(g * 1.943844, 1),
        "wind_dir": _num(rec.get("WDIR")),
        "wave_ft": None if h is None else round(h * 3.28084, 1),
        "dominant_period_s": _num(rec.get("DPD")),
        "wave_dir": _num(rec.get("MWD")),
        "water_f": None if wt is None else round(wt * 9 / 5 + 32, 1),
        "air_f": None if at is None else round(at * 9 / 5 + 32, 1),
    }


@cached(24 * 3600)
async def stations_in(bbox: tuple) -> list[dict]:
    r = await client().get(ACTIVE)
    r.raise_for_status()
    return parse_active(r.text, bbox)


@cached(10 * 60)
async def latest(station_id: str) -> dict | None:
    r = await client().get(REALTIME.format(id=station_id))
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return parse_realtime(r.text)


async def nearest_observation(lat: float, lon: float, bbox: tuple, max_nm: float = 60, tries: int = 3) -> dict | None:
    sts = sorted(await stations_in(bbox), key=lambda s: distance_nm(lat, lon, s["lat"], s["lon"]))
    for s in sts[:tries]:
        d = distance_nm(lat, lon, s["lat"], s["lon"])
        if d > max_nm:
            break
        obs = await latest(s["id"])
        if obs:
            return {"station": s, "distance_nm": round(d, 1), **obs}
    return None


def parse_history(text: str, hours: int = 24 * 45) -> list[dict]:
    """Every row of a realtime2 file (45 days, newest first) -> one row per hour, oldest first.
    Keeps the first reading in each hour; units converted like parse_realtime."""
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 3:
        return []
    hdr = lines[0].lstrip("#").split()
    seen, out = set(), []
    for line in lines[2:]:
        rec = dict(zip(hdr, line.split()))
        try:
            t = datetime(int(rec["YY"]), int(rec["MM"]), int(rec["DD"]), int(rec["hh"]), tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        if t in seen:
            continue
        seen.add(t)
        w = _num(rec.get("WSPD")); g = _num(rec.get("GST")); h = _num(rec.get("WVHT"))
        wt = _num(rec.get("WTMP")); at = _num(rec.get("ATMP")); p = _num(rec.get("PRES"))
        out.append({
            "t": t.isoformat(),
            "wind_kt": None if w is None else round(w * 1.943844, 1),
            "gust_kt": None if g is None else round(g * 1.943844, 1),
            "wind_dir": _num(rec.get("WDIR")),
            "wave_ft": None if h is None else round(h * 3.28084, 1),
            "period_s": _num(rec.get("DPD")),
            "wave_dir": _num(rec.get("MWD")),
            "water_f": None if wt is None else round(wt * 9 / 5 + 32, 1),
            "air_f": None if at is None else round(at * 9 / 5 + 32, 1),
            "pressure_mb": p,
        })
        if len(out) >= hours:
            break
    return out[::-1]


@cached(30 * 60)
async def history(station_id: str) -> list[dict]:
    r = await client().get(REALTIME.format(id=station_id))
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return parse_history(r.text)


async def nearest_stations(lat: float, lon: float, bbox: tuple, n: int = 4) -> list[dict]:
    sts = sorted(await stations_in(bbox), key=lambda s: distance_nm(lat, lon, s["lat"], s["lon"]))
    return [{**s, "distance_nm": round(distance_nm(lat, lon, s["lat"], s["lon"]), 1)} for s in sts[:n]]
