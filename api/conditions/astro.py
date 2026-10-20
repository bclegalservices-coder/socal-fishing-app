"""Moon phase, computed locally (no API, works offline)."""
import math
from datetime import datetime, timezone


def moon_phase(when: datetime) -> dict:
    """0 = new, 0.5 = full. Accurate to a few hours — plenty for fishing logs."""
    ref = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
    synodic = 29.530588853
    f = ((when - ref).total_seconds() / 86400.0 / synodic) % 1.0
    names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"]
    illum = (1 - math.cos(2 * math.pi * f)) / 2
    return {"phase": round(f, 3), "name": names[int(f * 8 + 0.5) % 8], "illumination": round(illum, 2)}


def sun_times(lat: float, lon: float, day) -> dict:
    """Sunrise / sunset (UTC datetimes) for a calendar date — standard sunrise equation, within ~1-2 min.
    lon is east-positive (SoCal is negative)."""
    from datetime import date as _date, timedelta
    n = (day - _date(2000, 1, 1)).days
    j_star = n - lon / 360.0
    m = math.radians((357.5291 + 0.98560028 * j_star) % 360)
    c = 1.9148 * math.sin(m) + 0.02 * math.sin(2 * m) + 0.0003 * math.sin(3 * m)
    lam = math.radians((math.degrees(m) + c + 180 + 102.9372) % 360)
    j_transit = 2451545.0 + j_star + 0.0053 * math.sin(m) - 0.0069 * math.sin(2 * lam)
    dec = math.asin(math.sin(lam) * math.sin(math.radians(23.44)))
    phi = math.radians(lat)
    cos_w = (math.sin(math.radians(-0.833)) - math.sin(phi) * math.sin(dec)) / (math.cos(phi) * math.cos(dec))
    base = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
    to_dt = lambda jd: base + timedelta(days=jd - 2451545.0)  # noqa: E731
    if cos_w <= -1 or cos_w >= 1:
        return {"sunrise": None, "sunset": None}
    w = math.degrees(math.acos(cos_w))
    return {"sunrise": to_dt(j_transit - w / 360), "sunset": to_dt(j_transit + w / 360)}
