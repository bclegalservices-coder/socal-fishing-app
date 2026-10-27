"""Live air traffic over SoCal, with circling / spotter-plane detection (Oct 27).

Small planes broadcast their position, height and speed every second (ADS-B). Hobbyist receivers share it online.
The server asks ONE source for every plane over the SoCal waters about every 10 seconds (however many phones are
watching), remembers each plane's recent path, and works out:
  • circling   — it has turned at least one full circle in the last ~12 minutes while staying in a small area
  • likely spotter — circling (or working back and forth) LOW and SLOW out over the WATER, like a fish-spotter plane
Phones get the planes (and the recent loops of the interesting ones) from GET /air.

Sources (first that answers wins), set with AIR_SOURCES (comma list of URL templates with {lat} {lon} {radius}):
  adsb.lol — open data (ODbL; give credit). airplanes.live is only used when AIR_ALLOW_NONCOMMERCIAL=1, because its
  terms are non-commercial (fine for testing with friends; not for the public app with sponsors).
"""
from __future__ import annotations

import asyncio
import math
import os
import time
from collections import deque

CENTER = (33.0, -118.8)            # middle of the SoCal waters
RADIUS_NM = 180                    # reaches Point Conception, San Diego and past San Clemente Island
POLL_S = 9.0                       # never ask the source more often than this
KEEP_S = 25 * 60                   # how much of each plane's path to remember
FORGET_S = 10 * 60                 # drop planes not heard for this long
WATCH_S = 12 * 60                  # window for the circling test
BBOX = (-121.0, 31.0, -116.6, 35.0)

DEFAULT_SOURCES = ["https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"]
NONCOMMERCIAL_SOURCES = ["https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}"]
CREDIT = {"adsb.lol": "Aircraft data: adsb.lol (ODbL)", "airplanes.live": "Aircraft data: airplanes.live"}

HELI_TYPES = ("R22", "R44", "R66", "EC20", "EC30", "EC35", "EC45", "EC55", "EC75", "AS50", "AS55", "AS65", "B06", "B407",
              "B412", "B429", "B505", "H125", "H130", "H135", "H145", "H160", "S76", "S92", "A109", "A119", "A139", "H60", "H47")


def sources() -> list[str]:
    env = [s.strip() for s in os.environ.get("AIR_SOURCES", "").split(",") if s.strip()]
    out = env or list(DEFAULT_SOURCES)
    if os.environ.get("AIR_ALLOW_NONCOMMERCIAL") == "1":
        out += [s for s in NONCOMMERCIAL_SOURCES if s not in out]
    return out


def _alt(a) -> float | None:
    v = a.get("alt_baro", a.get("alt_geom"))
    if v == "ground":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def is_water(lat: float, lon: float, depth_lookup=None) -> bool:
    """Over the ocean? Uses the seafloor model (NaN = land). Outside it: east of the region is land, the rest is sea."""
    if depth_lookup is not None:
        try:
            v = depth_lookup(lat, lon)
            if v is not None:
                return math.isfinite(v)
        except Exception:
            pass
    if lon > BBOX[2] or (lat > 34.45 and lon > -120.6):             # inland / north of the Santa Barbara coast
        return False
    return True


def kind_of(a: dict, alt: float | None) -> str:
    t = (a.get("t") or "").upper()
    if a.get("category") == "A7" or t.startswith(HELI_TYPES):
        return "heli"
    if alt is not None and alt >= 18000:
        return "high"
    if a.get("category") in ("A3", "A4", "A5") or (a.get("gs") or 0) > 250:
        return "jet"
    return "small"


def _unwrap_turn(tracks: list[float]) -> float:
    """Total turning (degrees, signed) along a list of headings."""
    tot = 0.0
    for a, b in zip(tracks, tracks[1:]):
        d = (b - a + 540.0) % 360.0 - 180.0
        if abs(d) < 120:                                             # ignore jumps from gaps in the data
            tot += d
    return tot


def analyze(path: list[tuple], now: float) -> dict:
    """Circling / loitering from a plane's recent path [(t, lat, lon, alt, gs, track)]."""
    pts = [p for p in path if now - p[0] <= WATCH_S]
    if len(pts) < 6:
        return {"circling": False, "circles": 0.0, "turn_deg": 0.0, "loiter_min": 0.0, "span_nm": None}
    k = math.cos(math.radians(pts[-1][1]))
    xy = [((p[2] * k) * 60.0, p[1] * 60.0) for p in pts]          # nautical miles (approx.)
    dist = sum(math.dist(a, b) for a, b in zip(xy, xy[1:]))
    net = math.dist(xy[0], xy[-1])
    xs = [q[0] for q in xy]; ys = [q[1] for q in xy]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    tracks = [p[5] for p in pts if p[5] is not None and (p[4] or 0) > 25]
    turn = _unwrap_turn(tracks) if len(tracks) >= 4 else 0.0
    minutes = (pts[-1][0] - pts[0][0]) / 60.0
    circles = abs(turn) / 360.0
    # circling: a full turn (or more) while staying within ~8 NM; or flying lots of miles but going nowhere (orbits,
    # figure-eights, back-and-forth over a school)
    circling = (circles >= 1.0 and span <= 8.0) or (minutes >= 5 and dist >= 6 and net < dist * 0.25 and span <= 6.0)
    return {"circling": bool(circling), "circles": round(circles, 1), "turn_deg": round(turn), "loiter_min": round(minutes, 1),
            "span_nm": round(span, 1)}


class Tracker:
    def __init__(self):
        self.paths: dict[str, deque] = {}
        self.info: dict[str, dict] = {}
        self.last_fetch = 0.0
        self.last_ok = 0.0
        self.source = None
        self.error = None
        self._lock = asyncio.Lock()

    def ingest(self, ac: list[dict], now: float):
        for a in ac:
            hx = (a.get("hex") or "").lower().strip()
            lat, lon = a.get("lat"), a.get("lon")
            if not hx or lat is None or lon is None:
                continue
            seen = float(a.get("seen_pos", a.get("seen", 0)) or 0)
            t = now - seen
            alt = _alt(a)
            p = (t, float(lat), float(lon), alt, a.get("gs"), a.get("track"))
            dq = self.paths.setdefault(hx, deque())
            if not dq or t > dq[-1][0] + 1:
                dq.append(p)
            while dq and now - dq[0][0] > KEEP_S:
                dq.popleft()
            self.info[hx] = {**a, "_t": t}
        for hx in [h for h, i in self.info.items() if now - i["_t"] > FORGET_S]:
            self.info.pop(hx, None); self.paths.pop(hx, None)

    def snapshot(self, now: float, depth_lookup=None, include_high: bool = False) -> dict:
        planes, trails = [], {}
        for hx, a in self.info.items():
            alt = _alt(a)
            if alt == 0.0:                                             # on the ground
                continue
            kind = kind_of(a, alt)
            if kind == "high" and not include_high:
                continue
            lat, lon = self.paths[hx][-1][1], self.paths[hx][-1][2]
            if not (BBOX[0] - 0.5 <= lon <= BBOX[2] + 0.5 and BBOX[1] - 0.5 <= lat <= BBOX[3] + 0.5):
                continue
            path = list(self.paths[hx])
            an = analyze(path, now)
            water = is_water(lat, lon, depth_lookup)
            gs = a.get("gs")
            low = alt is not None and alt <= 3000
            slow = gs is not None and 40 <= gs <= 160
            spotter = bool(an["circling"] and low and slow and water and kind != "heli")
            planes.append({
                "hex": hx, "callsign": (a.get("flight") or "").strip() or None, "reg": a.get("r"), "type": a.get("t"),
                "lat": round(lat, 5), "lon": round(lon, 5), "alt_ft": None if alt is None else int(alt),
                "gs_kt": None if gs is None else round(gs), "track": None if a.get("track") is None else round(a["track"]),
                "age_s": round(now - a["_t"]), "kind": kind, "water": water, "low": bool(low), "slow": bool(slow),
                "circling": an["circling"], "circles": an["circles"], "loiter_min": an["loiter_min"], "spotter": spotter,
            })
            if an["circling"] or (low and slow and water and kind == "small"):
                trails[hx] = [[round(p[2], 5), round(p[1], 5)] for p in path if now - p[0] <= 20 * 60][::1]
        planes.sort(key=lambda p: (not p["spotter"], not p["circling"], p["alt_ft"] or 0))
        src = (self.source or "").split("/")[2] if self.source else None
        return {"updated": self.last_ok, "age_s": round(now - self.last_ok) if self.last_ok else None,
                "source": src, "credit": CREDIT.get(src or "", "Aircraft data: ADS-B network"), "error": self.error,
                "count": len(planes), "circling": sum(p["circling"] for p in planes), "spotters": sum(p["spotter"] for p in planes),
                "planes": planes, "trails": trails}

    async def refresh(self, fetch, now: float | None = None) -> None:
        """Ask the source for planes, at most every POLL_S seconds (many phones share one request)."""
        now = now if now is not None else time.time()
        if now - self.last_fetch < POLL_S:
            return
        async with self._lock:
            if now - self.last_fetch < POLL_S:                       # another request just did it
                return
            self.last_fetch = now
            for url in sources():
                try:
                    data = await fetch(url.format(lat=CENTER[0], lon=CENTER[1], radius=RADIUS_NM))
                    ac = data.get("ac") or data.get("aircraft") or []
                    src_now = data.get("now")                            # the source's clock (ms or s); "seen" counts back from it
                    if src_now:
                        src_now = float(src_now) / (1000.0 if float(src_now) > 1e11 else 1.0)
                        lag = max(0.0, now - src_now) if abs(now - src_now) < 600 else 0.0
                    else:
                        lag = 0.0
                    self.ingest([{**a, "seen_pos": float(a.get("seen_pos", a.get("seen", 0)) or 0) + lag} for a in ac], now)
                    self.source, self.last_ok, self.error = url, now, None
                    return
                except Exception as e:                                # try the next source
                    self.error = f"{url.split('/')[2]}: {type(e).__name__}"
            # every source failed: keep the last planes (each shows its age)


TRACKER = Tracker()
_keepalive_until = 0.0


async def _fetch(url: str) -> dict:
    from core.http import client
    r = await client().get(url, headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()


async def _keep_tracking():
    """While someone has the layer on, keep polling between their requests so circles are caught in full."""
    while time.time() < _keepalive_until:
        try:
            await TRACKER.refresh(_fetch)
        except Exception:
            pass
        await asyncio.sleep(POLL_S + 1)


_task: asyncio.Task | None = None


async def current(include_high: bool = False) -> dict:
    global _keepalive_until, _task
    _keepalive_until = time.time() + 15 * 60
    if _task is None or _task.done():
        _task = asyncio.create_task(_keep_tracking())
    await TRACKER.refresh(_fetch)
    return TRACKER.snapshot(time.time(), _depth_lookup(), include_high)


_depth_cache: list = [0.0, None]


def _depth_lookup():
    """Seafloor model lookup (NaN on land), loaded at most once an hour."""
    if time.time() - _depth_cache[0] < 3600:
        return _depth_cache[1]
    fn = None
    try:
        from conditions.service import latest_grid
        g, _ = latest_grid("bathy")
        if g is not None:
            fn = lambda lat, lon: float(g.sample(lat, lon))          # noqa: E731
    except Exception:
        fn = None
    _depth_cache[0], _depth_cache[1] = time.time(), fn
    return fn
