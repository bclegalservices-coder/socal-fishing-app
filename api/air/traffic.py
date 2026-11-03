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
import re
import os
import time
from collections import deque

CENTER = (32.8, -119.0)            # middle of the SoCal waters, nudged offshore
RADIUS_NM = 230                    # Point Conception to the border, and well past San Clemente: Tanner & Cortes Banks
POLL_S = 9.0                       # never ask the source more often than this
KEEP_S = 25 * 60                   # how much of each plane's path to remember
FORGET_S = 10 * 60                 # drop planes not heard for this long
# Nov 1: planes someone tapped "Watch" on keep their whole path (up to WATCH_KEEP_S), so the app can draw where they've
# been. A phone renews the watch every time it asks for the path; unrenewed watches end after WATCH_TTL_S.
WATCH_KEEP_S = 6 * 3600
WATCH_TTL_S = 12 * 3600
WATCHED: dict[str, float] = {}       # hex -> watch ends (unix time)
WATCH_S = 12 * 60                  # window for the circling test
BBOX = (-122.3, 30.3, -116.6, 35.0)   # Oct 27: wider, offshore — beyond San Clemente Island and the outer banks

DEFAULT_SOURCES = ["https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"]
NONCOMMERCIAL_SOURCES = ["https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}",
                         "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{radius}"]
CREDIT = {"adsb.lol": "Aircraft data: adsb.lol (ODbL)", "airplanes.live": "Aircraft data: airplanes.live", "adsb.fi": "Aircraft data: adsb.fi"}

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
    # outside the seafloor model: Oct 30 — use the real mainland coastline (it used to be a rough guess, which let
    # planes over Avila / San Luis Obispo count as "over the water")
    if lon > BBOX[2]:
        return False
    from .coast import on_mainland
    return not on_mainland(lat, lon)


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
        self.sources_ok: list[str] = []
        self.error = None
        self._lock = asyncio.Lock()
        self.cached: tuple | None = None       # (time, snapshot) — shared by /air and the spotter recorder
        self.via_relay = False

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
            keep = WATCH_KEEP_S if WATCHED.get(hx, 0) > now else KEEP_S
            while dq and now - dq[0][0] > keep:
                dq.popleft()
            self.info[hx] = {**a, "_t": t}
        for hx in [h for h, i in self.info.items() if now - i["_t"] > FORGET_S]:
            self.info.pop(hx, None)
            if WATCHED.get(hx, 0) <= now:            # a watched plane keeps its path after it lands / flies out of range
                self.paths.pop(hx, None)
        for hx in [h for h, t in WATCHED.items() if t <= now]:
            WATCHED.pop(hx, None)
            if hx not in self.info:
                self.paths.pop(hx, None)

    def snapshot(self, now: float, depth_lookup=None, include_high: bool = False, include_land: bool = False) -> dict:
        """Planes for the app. Oct 27: only over the WATER by default (planes over land aren't useful to fishermen)."""
        planes, trails = [], {}
        paths = dict(self.paths)                                       # copies: safe while new positions arrive
        for hx, a in list(self.info.items()):
            dq = paths.get(hx)
            if not dq:
                continue
            alt = _alt(a)
            if alt == 0.0:                                             # on the ground
                continue
            kind = kind_of(a, alt)
            if kind == "high" and not include_high:
                continue
            last = dq[-1]
            lat, lon = last[1], last[2]
            if not (BBOX[0] - 0.5 <= lon <= BBOX[2] + 0.5 and BBOX[1] - 0.5 <= lat <= BBOX[3] + 0.5):
                continue
            water = is_water(lat, lon, depth_lookup)
            if not water and not include_land:
                continue
            path = list(dq)
            an = analyze(path, now)
            gs = a.get("gs")
            low = alt is not None and alt <= 3000
            slow = gs is not None and 40 <= gs <= 160
            # Oct 29: the spotter feature only looks ≥ 5 NM off the mainland and outside the harbor training area,
            # and the loops themselves must be out there too (not circling over land or along the beach)
            from .coast import spotter_waters
            offshore = water and spotter_waters(lat, lon)
            if offshore and an["circling"]:
                recent = [q for q in path if now - q[0] <= WATCH_S][::3]
                ok = sum(1 for q in recent if is_water(q[1], q[2], depth_lookup) and spotter_waters(q[1], q[2]))
                offshore = ok >= 0.75 * max(1, len(recent))
            if not offshore:
                an = {**an, "circling": False}                          # no orange highlight / loops near shore
            spotter = bool(an["circling"] and low and slow and water and kind != "heli")
            planes.append({
                "hex": hx, "callsign": (a.get("flight") or "").strip() or None, "reg": a.get("r"), "type": a.get("t"),
                # Oct 28: full model name, year built and registered owner/operator when the network knows them
                "desc": (a.get("desc") or "").strip() or None, "owner": (a.get("ownOp") or "").strip() or None,
                "year": str(a.get("year")).strip() if a.get("year") else None,
                "lat": round(lat, 5), "lon": round(lon, 5), "alt_ft": None if alt is None else int(alt),
                "gs_kt": None if gs is None else round(gs), "track": None if a.get("track") is None else round(a["track"]),
                "age_s": round(now - a["_t"]), "kind": kind, "water": water, "low": bool(low), "slow": bool(slow),
                "circling": an["circling"], "circles": an["circles"], "loiter_min": an["loiter_min"], "spotter": spotter, "offshore": bool(offshore),
            })
            if an["circling"] or (low and slow and offshore and kind == "small"):
                trails[hx] = [[round(p[2], 5), round(p[1], 5)] for p in path if now - p[0] <= 20 * 60][::1]
        planes.sort(key=lambda p: (not p["spotter"], not p["circling"], p["alt_ft"] or 0))
        src = (self.source or "").split("/")[2] if self.source else None
        names = self.sources_ok or ([src] if src else [])
        credit = ", ".join(CREDIT.get(n, n).replace("Aircraft data: ", "") for n in names)
        return {"updated": self.last_ok, "age_s": round(now - self.last_ok) if self.last_ok else None,
                "source": src, "sources": names, "credit": f"Aircraft data: {credit}" if credit else "Aircraft data: ADS-B network", "error": self.error,
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
            # Ask every configured source at once and merge them: each network has different receivers, so together
            # they hear more low planes far offshore. A plane heard by several keeps its freshest position.
            urls = sources()
            results = await asyncio.gather(*[fetch(u.format(lat=CENTER[0], lon=CENTER[1], radius=RADIUS_NM)) for u in urls], return_exceptions=True)
            merged: dict[str, dict] = {}
            ok, errs = [], []
            for url, data in zip(urls, results):
                if isinstance(data, BaseException) or not isinstance(data, dict):
                    errs.append(f"{url.split('/')[2]}: {type(data).__name__}")
                    continue
                ok.append(url)
                ac = data.get("ac") or data.get("aircraft") or []
                src_now = data.get("now")                                # the source's clock (ms or s); "seen" counts back from it
                lag = 0.0
                if src_now:
                    src_now = float(src_now) / (1000.0 if float(src_now) > 1e11 else 1.0)
                    lag = max(0.0, now - src_now) if abs(now - src_now) < 600 else 0.0
                for a in ac:
                    hx = (a.get("hex") or "").lower().strip()
                    if not hx or a.get("lat") is None:
                        continue
                    a = {**a, "seen_pos": float(a.get("seen_pos", a.get("seen", 0)) or 0) + lag}
                    if hx not in merged or a["seen_pos"] < merged[hx]["seen_pos"]:
                        merged[hx] = a
            if ok:
                self.ingest(list(merged.values()), now)
                self.source, self.last_ok = ok[0], now
                self.sources_ok = [u.split("/")[2] for u in ok]
                self.error = "; ".join(errs) or None
                return
            self.error = "; ".join(errs)
            # every source failed: keep the last planes (each shows its age)


TRACKER = Tracker()
_keepalive_until = 0.0


# Nov 2: if a plane network blocks or stalls on the server, ask through the Channel Nav chart helper (Cloudflare).
FEED_RELAY = os.environ.get("AIR_RELAY", "https://channelnav-chart.bclegalservices.workers.dev/feed").rstrip("/")


def relay_url(url: str) -> str | None:
    m = re.match(r"https://([a-z0-9.-]+)(/.*)$", url)
    return f"{FEED_RELAY}/{m.group(1)}{m.group(2)}" if (m and FEED_RELAY) else None


async def _fetch(url: str) -> dict:
    import httpx
    from core.http import client
    try:
        r = await client().get(url, headers={"Accept": "application/json"}, timeout=httpx.Timeout(12.0, connect=6.0))
        r.raise_for_status()
        return r.json()
    except Exception as e:
        alt = relay_url(url)
        if not alt:
            raise
        r = await client().get(alt, headers={"Accept": "application/json"}, timeout=httpx.Timeout(15.0, connect=6.0))
        r.raise_for_status()
        TRACKER.via_relay = True
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
    """Nov 2: answers fast. The spotter recorder already refreshes the planes every ~10 s and keeps its latest
    snapshot, so phones get that (computed once, shared) instead of waiting on the plane network themselves."""
    global _keepalive_until, _task
    _keepalive_until = time.time() + 15 * 60
    if _task is None or _task.done():
        _task = asyncio.create_task(_keep_tracking())
    now = time.time()
    if not include_high and TRACKER.cached and now - TRACKER.cached[0] < 15:
        return TRACKER.cached[1]
    try:
        await asyncio.wait_for(asyncio.shield(TRACKER.refresh(_fetch)), 8)
    except Exception:
        pass                                   # slow or failed: show what we have (each plane shows its age)
    snap = await asyncio.to_thread(TRACKER.snapshot, time.time(), _depth_lookup(), include_high)
    if not include_high:
        TRACKER.cached = (time.time(), snap)
    return snap


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
            la0, la1, lo0, lo1 = float(g.lats[0]), float(g.lats[-1]), float(g.lons[0]), float(g.lons[-1])

            def fn(lat, lon):
                # Oct 27: past the edge of the seafloor grid (west / south of San Clemente) say "don't know" (None)
                # so is_water() uses its open-ocean rule — it used to count as land and drop those planes.
                if not (la0 <= lat <= la1 and lo0 <= lon <= lo1):
                    return None
                return float(g.sample(lat, lon))
    except Exception:
        fn = None
    _depth_cache[0], _depth_cache[1] = time.time(), fn
    return fn


def watched_paths(hexes: list[str], now: float, hours: float = 6.0) -> dict:
    """Nov 1: the recorded flight path of each watched plane (also renews the watch): what the server saw in the
    last `hours`, plus any spotter sessions recorded for it (air/history.py). {hex: [[lon, lat, t, alt], ...]}"""
    from .history import RECORDER
    out = {}
    for hx in hexes[:20]:
        hx = hx.lower().strip()
        if not re.fullmatch(r"[0-9a-f~]{1,8}", hx):
            continue
        WATCHED[hx] = now + WATCH_TTL_S
        pts = {int(p[0]): [round(p[2], 5), round(p[1], 5), int(p[0]), None if p[3] is None else int(p[3])]
               for p in TRACKER.paths.get(hx, []) if now - p[0] <= hours * 3600}
        for sess in RECORDER.sessions.values():
            if sess.get("hex") == hx and now - sess.get("last_t", 0) <= hours * 3600:
                for q in sess.get("points", []):
                    if now - q[2] <= hours * 3600:
                        pts.setdefault(int(q[2]), [q[0], q[1], int(q[2]), q[3]])
        # Nov 2: only where it flew over the WATER — no flight paths drawn over the mainland
        from .coast import on_mainland
        line = [pts[t] for t in sorted(pts) if not on_mainland(pts[t][1], pts[t][0])]
        if len(line) > 1500:                                   # thin very long paths (keep the newest part full)
            half = len(line) // 2
            line = line[:half:2] + line[half:]
        out[hx] = line
    return out
