"""Decides which push alerts to send (plan: 'Alerts'). Pure functions — the job feeds them data.
Rules: opt-in only, max 4 alerts per person per day, each subscription at most every 3 h
(weather warnings: once per new warning)."""
import math
from datetime import datetime, timedelta, timezone

MAX_PER_DAY = 4
MIN_GAP = timedelta(hours=3)
NAMES = {"BFT": "bluefin", "YFT": "yellowfin", "YT": "yellowtail", "DOR": "dorado", "WSB": "white seabass", "CAL": "calico bass",
         "HAL": "halibut", "RCK": "rockfish", "ALB": "albacore", "WAH": "wahoo", "SWD": "swordfish", "MAR": "marlin"}


def nm(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 2 * 3440.065 * math.asin(min(1, math.sqrt(h)))


def _within(sub: dict, lat: float, lon: float) -> bool:
    c = sub["params"].get("center")
    return c is None or nm(c[1], c[0], lat, lon) <= float(sub["params"].get("radius_nm", 20))


def can_send(sub: dict, sent_today_for_user: int, now: datetime) -> bool:
    if sent_today_for_user >= MAX_PER_DAY:
        return False
    last = sub.get("last_sent_at")
    return last is None or now - last >= MIN_GAP


def species_alert(sub: dict, catches: list[dict], now: datetime) -> str | None:
    """New public catches of the chosen species in the chosen area since the last alert."""
    p = sub["params"]
    since = max(sub.get("last_sent_at") or now - timedelta(hours=1), now - timedelta(hours=3))
    codes = set(p.get("species") or [])
    hits = [c for c in catches if c["caught_at"] > since and (not codes or c["species_code"] in codes)
            and (not p.get("verified_only") or c["verified"]) and c.get("lat") is not None and _within(sub, c["lat"], c["lon"])]
    if not hits:
        return None
    fish = sum(c.get("quantity") or 1 for c in hits)
    sp = ", ".join(sorted({NAMES.get(c["species_code"], c["species_code"]) for c in hits}))
    where = p.get("label") or "your area"
    v = "verified " if p.get("verified_only") else ""
    return f"{len(hits)} {v}{sp} report{'s' if len(hits) > 1 else ''} near {where} ({fish} fish)."


def activity_alert(sub: dict, catches: list[dict], now: datetime) -> str | None:
    """Activity jumped: at least 5 reports in the last 6 h and at least double the 6 h before."""
    p = sub["params"]
    codes = set(p.get("species") or [])
    rel = [c for c in catches if (not codes or c["species_code"] in codes) and c.get("lat") is not None and _within(sub, c["lat"], c["lon"])]
    recent = sum(1 for c in rel if c["caught_at"] > now - timedelta(hours=6))
    before = sum(1 for c in rel if now - timedelta(hours=12) < c["caught_at"] <= now - timedelta(hours=6))
    if recent >= 5 and recent >= 2 * max(1, before):
        sp = ", ".join(sorted({NAMES.get(c, c) for c in codes})) or "Fishing"
        return f"{sp.capitalize()} activity jumped near {p.get('label') or 'your area'}: {recent} reports in the last 6 h."
    return None


def sst_alert(sub: dict, cells_in_radius: list[float], image_date: str, now: datetime) -> str | None:
    """Once per day: at least 10% of the water within the radius is in the chosen temperature range."""
    p = sub["params"]
    last = sub.get("last_sent_at")
    if last and last.date() == now.date():
        return None
    vals = [v for v in cells_in_radius if v is not None and math.isfinite(v)]
    if not vals:
        return None
    lo, hi = float(p.get("min_f", 0)), float(p.get("max_f", 100))
    frac = sum(1 for v in vals if lo <= v <= hi) / len(vals)
    if frac >= 0.10:
        return f"Water {lo:.0f}–{hi:.0f}°F within {p.get('radius_nm', 20)} NM of {p.get('label') or 'your area'} (satellite, {image_date})."
    return None


def weather_alert(sub: dict, alerts: list[dict]) -> tuple[str | None, list[str]]:
    """Each new NWS warning once. Returns (message, ids to remember)."""
    seen = set((sub.get("state") or {}).get("seen", []))
    new = [a for a in alerts if f"{a['event']}|{a.get('ends')}" not in seen]
    ids = [f"{a['event']}|{a.get('ends')}" for a in alerts]
    if not new:
        return None, ids
    a = new[0]
    more = f" (+{len(new) - 1} more)" if len(new) > 1 else ""
    return f"{a['event']} near {sub['params'].get('label') or 'your area'}{more}.", ids
