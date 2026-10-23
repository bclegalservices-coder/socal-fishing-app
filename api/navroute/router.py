"""Auto route: the shortest path over water between points, like Navionics Auto Guidance / Garmin Auto Guidance.

How a leg is found:
  1. Short trips (≤ 2 NM): one search on the ~10 m water map covering both ends.
  2. Longer trips: from each end, a ~10 m search out of the slip / marina / harbor to the nearest open water;
     then a ~200 m search across open water between those two exits. The three pieces are joined.
  3. The path is straightened into a few turn points: a point is skipped whenever the straight line around it stays
     on water, with a little room either side (no cutting breakwater tips or points of land).
Costs: land and breakwaters can't be crossed; charted water shallower than the safety depth costs 25× (used only
when there's no other way, e.g. leaving a shallow marina, and reported as a warning); being close to land costs extra,
more the closer you get, so routes keep SEA_ROOM_M of sea room in open water.
Sea room (Oct 23): straight lines between turn points keep up to SEA_ROOM_M (~0.25 NM) from land — never less room
than the searched path itself had, so harbor channels and marina exits (where there isn't that much room) still work.

It is a planning aid, not a safe route: it doesn't know about kelp, traffic, buoys, moorings, wrecks not drawn as
land, or water shallower than the chart says. The app says so on every route.
"""
from __future__ import annotations

import math

import numpy as np

from .grid import FRES, UNKNOWN, NavData, Window

R_NM = 3440.065
SHALLOW_COST = 25.0
SHORE_COST = 2.0          # next to land (fine map) or to a mixed cell (coarse map)
MAX_NODES = 420_000       # ~160 MB peak: fits the free server (512 MB) next to everything else
SEA_ROOM_M = 460.0        # ~0.25 NM: how far off land routes stay in open water
ROOM_COST = 3.0           # extra cost right at the shore, fading to 0 at SEA_ROOM_M


def dist_nm(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_NM * math.asin(min(1.0, math.sqrt(h)))


class NoRoute(Exception):
    pass


# ------------------------------------------------------------------ grid search

def _cost(win: Window, safety_ft: float, shore_ring: bool = True, sea_room_m: float = SEA_ROOM_M) -> np.ndarray:
    """Cost multiplier per cell (inf = can't go). Cells near land cost more, the closer the more (sea room)."""
    from scipy import ndimage
    c = np.ones(win.shape, dtype=np.float64)
    d = win.depth
    shallow = win.water & (d != UNKNOWN) & (d < safety_ft)
    c[shallow] = SHALLOW_COST
    if shore_ring:
        near = ndimage.binary_dilation(~win.water, iterations=1) & win.water
        c[near & ~shallow] = SHORE_COST
    if sea_room_m > 0 and (~win.water).any():
        cell_m = win.res * 111_000.0 * 0.92                # average of north–south and east–west at SoCal latitudes
        to_land = ndimage.distance_transform_edt(win.water) * cell_m
        c *= 1.0 + ROOM_COST * np.clip((sea_room_m - to_land) / sea_room_m, 0.0, 1.0) ** 2
    c[~win.water] = np.inf
    return c


def _search(win: Window, cost: np.ndarray, start: tuple[int, int], goal_mask: np.ndarray):
    """Cheapest path from start to any cell in goal_mask (8 neighbours). Returns list of (i, j) or None."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    h, w = cost.shape
    ok = np.isfinite(cost)
    if not ok[start] or not (goal_mask & ok).any():
        return None
    lat_mid = win.lat0 + win.res * h / 2
    dy = win.res * 60.0                                   # NM per cell north–south
    dx = dy * math.cos(math.radians(lat_mid))             # NM per cell east–west
    idx = np.arange(h * w).reshape(h, w)
    rows, cols, vals = [], [], []
    for di, dj, step in ((0, 1, dx), (1, 0, dy), (1, 1, math.hypot(dx, dy)), (1, -1, math.hypot(dx, dy))):
        # cell (i, j) → neighbour (i + di, j + dj)
        a_i, b_i = slice(0, h - di), slice(di, h)
        a_j, b_j = {1: (slice(0, w - 1), slice(1, w)), 0: (slice(0, w), slice(0, w)), -1: (slice(1, w), slice(0, w - 1))}[dj]
        both = ok[a_i, a_j] & ok[b_i, b_j]
        if di == 1 and dj != 0:                           # no squeezing diagonally between two land corners
            both &= ok[a_i, b_j] | ok[b_i, a_j]
        rows.append(idx[a_i, a_j][both]); cols.append(idx[b_i, b_j][both])
        vals.append(step * 0.5 * (cost[a_i, a_j][both] + cost[b_i, b_j][both]))
    r = np.concatenate(rows); c = np.concatenate(cols); v = np.concatenate(vals)
    g = coo_matrix((v, (r, c)), shape=(h * w, h * w)).tocsr()
    del r, c, v, rows, cols, vals
    s = int(idx[start])
    dist, pred = dijkstra(g, directed=False, indices=s, return_predecessors=True)
    del g
    goals = np.flatnonzero(goal_mask.ravel() & np.isfinite(dist))
    if goals.size == 0:
        return None
    t = int(goals[np.argmin(dist[goals])])
    path = []
    while t != s and t >= 0:
        path.append(divmod(t, w)); t = int(pred[t])
    path.append(divmod(s, w))
    return path[::-1]


def _snap(win: Window, cost: np.ndarray, ij: tuple[int, int]) -> tuple[int, int] | None:
    """Nearest passable cell (a pin dropped on the dock or a breakwater counts as the water next to it)."""
    from scipy import ndimage
    if np.isfinite(cost[ij]):
        return ij
    bad = ~np.isfinite(cost)
    if bad.all():
        return None
    _, (ii, jj) = ndimage.distance_transform_edt(bad, return_indices=True)
    cand = (int(ii[ij]), int(jj[ij]))
    # don't jump more than ~300 m to find water
    if math.hypot(cand[0] - ij[0], cand[1] - ij[1]) * win.res * 111_000 > 300:
        return None
    return cand


def _to_lonlat(win: Window, cells) -> list[tuple[float, float]]:
    return [win.center(i, j) for i, j in cells]


def _fine_step(span_lat: float, span_lon: float) -> int:
    cells = (span_lat / FRES) * (span_lon / FRES)
    return 1 if cells <= MAX_NODES else 2 if cells <= MAX_NODES * 4 else 3


# ------------------------------------------------------------------ pieces of a leg

def _fine_direct(nd: NavData, a, b, safety_ft):
    pad = 0.008
    lat0, lat1 = min(a[0], b[0]) - pad, max(a[0], b[0]) + pad
    lon0, lon1 = min(a[1], b[1]) - pad, max(a[1], b[1]) + pad
    win = nd.fine(lon0, lat0, lon1, lat1, step=_fine_step(lat1 - lat0, lon1 - lon0))
    cost = _cost(win, safety_ft)
    s = _snap(win, cost, win.cell(*a)); g = _snap(win, cost, win.cell(*b))
    if s is None:
        raise NoRoute("the start isn't on or near the water")
    if g is None:
        raise NoRoute("the destination isn't on or near the water")
    goal = np.zeros(win.shape, dtype=bool); goal[g] = True
    p = _search(win, cost, s, goal)
    if p is None:
        raise NoRoute("no water path found")
    return _to_lonlat(win, p)


def _exit(nd: NavData, p, safety_ft, which: str = 'start'):
    """From a point (maybe deep inside a marina) to the nearest open water. Returns a path [(lat, lon), …]."""
    if nd.coarse_open(p[0], p[1], safety_ft):
        return [p]
    for r in (0.025, 0.04, 0.08, 0.15):
        win = nd.fine(p[1] - r, p[0] - r * 0.85, p[1] + r, p[0] + r * 0.85, step=_fine_step(1.7 * r, 2 * r))
        cost = _cost(win, safety_ft)
        s = _snap(win, cost, win.cell(*p))
        if s is None:
            if not win.water.any() or r == 0.025:
                raise NoRoute(f"the {which} isn't on or near the water")
            continue
        # goal: cells that are open water on the coarse map
        h, w = win.shape
        lats = win.lat0 + (np.arange(h) + 0.5) * win.res
        lons = win.lon0 + (np.arange(w) + 0.5) * win.res
        ci = np.floor((lats - nd.lat0) / 0.002).astype(int); cj = np.floor((lons - nd.lon0) / 0.002).astype(int)
        open_c = _coarse_open_grid(nd, safety_ft)
        ci = np.clip(ci, 0, open_c.shape[0] - 1); cj = np.clip(cj, 0, open_c.shape[1] - 1)
        goal = open_c[np.ix_(ci, cj)] & np.isfinite(cost)
        path = _search(win, cost, s, goal)
        if path:
            return _to_lonlat(win, path)
    raise NoRoute("couldn't find the way out to open water")


_open_cache: dict = {}


def _coarse_open_grid(nd: NavData, safety_ft: float) -> np.ndarray:
    key = (id(nd), round(safety_ft))
    if key not in _open_cache:
        from scipy import ndimage
        w = nd.cwater
        allnb = ndimage.binary_erosion(w, structure=np.ones((3, 3), bool), border_value=1)
        d = nd.cdepth
        _open_cache.clear()
        _open_cache[key] = allnb & ((d == UNKNOWN) | (d >= safety_ft))
    return _open_cache[key]


def _coarse(nd: NavData, a, b, safety_ft):
    span = max(abs(a[0] - b[0]), abs(a[1] - b[1]))
    pad = max(0.06, 0.3 * span)
    lat0, lat1 = min(a[0], b[0]) - pad, max(a[0], b[0]) + pad
    lon0, lon1 = min(a[1], b[1]) - pad, max(a[1], b[1]) + pad
    cells = ((lat1 - lat0) / 0.002) * ((lon1 - lon0) / 0.002)
    step = max(1, math.ceil(math.sqrt(cells / MAX_NODES)))
    win = nd.coarse(lon0, lat0, lon1, lat1, step=step)
    cost = _cost(win, safety_ft)
    s = _snap(win, cost, win.cell(*a)); g = _snap(win, cost, win.cell(*b))
    if s is None or g is None:
        raise NoRoute("open-water ends not found")
    goal = np.zeros(win.shape, dtype=bool); goal[g] = True
    p = _search(win, cost, s, goal)
    if p is None:
        raise NoRoute("no open-water path found")
    return [a] + _to_lonlat(win, p)[1:-1] + [b]


# ------------------------------------------------------------------ straightening

def _clear(nd: NavData, p, q, allow_shallow: bool, safety_ft: float, room_m: float = 15.0, end_m: float = 60.0) -> bool:
    """True if the straight line p→q stays on water (with `room_m` either side, except near its ends)."""
    d_m = dist_nm(p, q) * 1852
    n = max(2, int(d_m / 8) + 1)
    t = np.linspace(0.0, 1.0, n)
    lats = p[0] + (q[0] - p[0]) * t
    lons = p[1] + (q[1] - p[1]) * t
    water, depth = nd.sample(lats, lons)
    if not water.all():
        return False
    if not allow_shallow and ((depth != UNKNOWN) & (depth < safety_ft)).any():
        return False
    end_m = min(end_m, max(15.0, room_m))
    if room_m > 0 and d_m > 2 * end_m:
        mid = (t * d_m > end_m) & ((1 - t) * d_m > end_m)
        if mid.any():
            cosl = math.cos(math.radians(p[0]))
            vy, vx = (q[0] - p[0]), (q[1] - p[1]) * cosl
            L = math.hypot(vx, vy) or 1.0
            ny, nx = vx / L, -vy / L                       # unit normal, in degrees-of-latitude units
            for r in sorted({room_m, room_m / 2, min(room_m, 15.0)}):   # several distances, so a thin point of land can't slip between
                off = r / 111_000.0
                for sgn in (1, -1):
                    w2, _ = nd.sample(lats[mid] + sgn * ny * off, lons[mid] + sgn * nx * off / cosl)
                    if not w2.all():
                        return False
    return True


_RINGS_M = (15.0, 30.0, 60.0, 100.0, 150.0, 220.0, 320.0, 460.0, 650.0, 900.0)


def clearance_m(nd: NavData, lats, lons, max_m: float = SEA_ROOM_M) -> np.ndarray:
    """Roughly how far each point is from the nearest land (m), capped at max_m. 0 on land."""
    lats = np.asarray(lats, np.float64); lons = np.asarray(lons, np.float64)
    out = np.full(lats.shape, max_m)
    w0, _ = nd.sample(lats, lons)
    out[~w0] = 0.0
    ang = np.linspace(0, 2 * math.pi, 16, endpoint=False)
    cosl = np.cos(np.radians(lats))[:, None]
    open_ = w0.copy()
    for r in [x for x in _RINGS_M if x < max_m] + [max_m]:
        if not open_.any():
            break
        idx = np.flatnonzero(open_)
        off = r / 111_000.0
        la = lats[idx, None] + off * np.cos(ang)[None, :]
        lo = lons[idx, None] + off * np.sin(ang)[None, :] / cosl[idx]
        w, _ = nd.sample(la.ravel(), lo.ravel())
        hit = ~w.reshape(la.shape).all(axis=1)
        out[idx[hit]] = r
        open_[idx[hit]] = False
    return out


def straighten(nd: NavData, path: list, safety_ft: float, sea_room_m: float = SEA_ROOM_M) -> list:
    """Fewest turn points. Each straight line keeps as much room from land as the searched path had along that
    stretch (80% of it), up to sea_room_m, and at least 15 m."""
    if len(path) <= 2:
        return path
    la = np.array([p[0] for p in path]); lo = np.array([p[1] for p in path])
    _, dep = nd.sample(la, lo)
    shallow = (dep != UNKNOWN) & (dep < safety_ft)
    clear = clearance_m(nd, la, lo, sea_room_m) if sea_room_m > 15 else np.full(la.shape, 15.0)

    def ok(i, m):
        room = float(min(sea_room_m, max(15.0, 0.8 * clear[i:m + 1].min())))
        return _clear(nd, path[i], path[m], bool(shallow[i:m + 1].any()), safety_ft, room_m=room)

    out = [path[0]]
    i, n = 0, len(path)
    while i < n - 1:
        if ok(i, n - 1):                                  # straight to the end?
            out.append(path[n - 1]); break
        # furthest point still in plain sight (doubling, then halving)
        lo_, step = i + 1, 1
        while lo_ + step < n and ok(i, lo_ + step):
            lo_ += step; step *= 2
        hi = min(n - 1, lo_ + step)
        while hi - lo_ > 1:
            m = (lo_ + hi) // 2
            if ok(i, m):
                lo_ = m
            else:
                hi = m
        out.append(path[lo_]); i = lo_
    return out


# ------------------------------------------------------------------ public

def route(nd: NavData, pts: list[tuple[float, float]], safety_ft: float = 8.0, launches: list[dict] | None = None) -> dict:
    """pts: [(lat, lon), …] start, optional via points, end. Returns the turn points and notes.
    launches: launch ramps / marinas [{name, kind, lat, lon}]. If the start is on land (you're at home, planning),
    the route starts from the nearest one that has a water path, and says so (`start_from`)."""
    if len(pts) < 2:
        raise NoRoute("need a start and an end")
    try:
        return _route(nd, pts, safety_ft)
    except NoRoute as e:
        if "start isn't on or near the water" not in str(e) or not launches:
            raise
    a = pts[0]
    near = sorted((l for l in launches if dist_nm(a, (l["lat"], l["lon"])) < 40), key=lambda l: dist_nm(a, (l["lat"], l["lon"])))
    for l in near[:8]:                     # closest first; skip any whose pin isn't really at the water
        try:
            r = _route(nd, [(l["lat"], l["lon"])] + list(pts[1:]), safety_ft)
        except NoRoute:
            continue
        r["start_from"] = {"name": l.get("name") or ("Launch ramp" if l.get("kind") == "ramp" else "Marina"), "kind": l.get("kind"),
                           "lat": l["lat"], "lon": l["lon"], "distance_nm": round(dist_nm(a, (l["lat"], l["lon"])), 1)}
        return r
    raise NoRoute("the start isn't on or near the water, and no launch ramp or marina nearby had a water path")


def launch_points(fc: dict) -> list[dict]:
    """Launch ramps and marinas from the harbors file (points only)."""
    out = []
    for f in (fc or {}).get("features", []):
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        if p.get("kind") in ("ramp", "marina") and g.get("type") == "Point":
            lon, lat = g["coordinates"][:2]
            out.append({"name": p.get("name"), "kind": p.get("kind"), "lat": float(lat), "lon": float(lon)})
    return out


def _route(nd: NavData, pts: list[tuple[float, float]], safety_ft: float) -> dict:
    turns: list = []
    is_target: list = []
    for a, b in zip(pts[:-1], pts[1:]):
        d = dist_nm(a, b)
        if d <= 2.0:
            leg = _fine_direct(nd, a, b, safety_ft)
        else:
            ea = _exit(nd, a, safety_ft, 'start')
            eb = _exit(nd, b, safety_ft, 'destination')
            mid = _coarse(nd, ea[-1], eb[-1], safety_ft)
            leg = ea + mid[1:-1] + eb[::-1]
        leg = [a] + leg[1:-1] + [b] if len(leg) >= 2 else [a, b]
        leg = straighten(nd, leg, safety_ft)          # per leg, so every stop you chose stays a turn point
        if not turns:
            turns.append(leg[0]); is_target.append(True)
        turns += leg[1:]; is_target += [False] * (len(leg) - 2) + [True]
    # check the final lines for shallow water
    warn = []
    lats, lons = [], []
    for p, q in zip(turns[:-1], turns[1:]):
        n = max(2, int(dist_nm(p, q) * 1852 / 20))
        t = np.linspace(0, 1, n)
        lats.append(p[0] + (q[0] - p[0]) * t); lons.append(p[1] + (q[1] - p[1]) * t)
    if lats:
        la, lo = np.concatenate(lats), np.concatenate(lons)
        _, dep = nd.sample(la, lo)
        sh = (dep != UNKNOWN) & (dep < safety_ft)
        if sh.any():
            k = int(np.flatnonzero(sh)[0])
            warn.append({"kind": "shallow", "lat": float(la[k]), "lon": float(lo[k]), "min_ft": int(dep[sh].min()),
                         "text": f"Passes charted water as shallow as {int(dep[sh].min())} ft (your safety depth is {safety_ft:g} ft)."})
        if (la < 32.53).any():
            warn.append({"kind": "rough", "text": "South of the border the coastline is rougher (no NOAA charts there)."})
    total = sum(dist_nm(p, q) for p, q in zip(turns[:-1], turns[1:]))
    straight = sum(dist_nm(p, q) for p, q in zip(pts[:-1], pts[1:]))
    return {"points": [{"lat": round(p[0], 6), "lon": round(p[1], 6), **({"target": True} if tg else {})} for p, tg in zip(turns, is_target)],
            "distance_nm": round(total, 2), "straight_nm": round(straight, 2), "turns": sum(1 for tg in is_target if not tg),
            "safety_ft": safety_ft, "warnings": warn,
            "note": "Auto route from NOAA charts — check it against the chart and keep a lookout. It doesn't know about kelp, traffic, moorings or changing depths."}
