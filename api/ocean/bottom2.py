"""python -m ocean.jobs bottom2  — the NEW bottom (Nov 12, "v7"): one smooth depth-colored seafloor map for all of
SoCal + depth contour lines sent as vector lines (always thin and sharp, like Navionics).

What changed from HD bottom v6 (bottomhd.py), and why:
  • No contour lines baked into the pictures. Baked lines were stretched with the picture when you zoomed in past
    zoom 14 and turned into fat jagged blocks. The lines are now separate vector tiles (mvt.py) the phone draws itself.
  • Gaps in NOAA's BlueTopo surveys are filled from NOAA's Coastal Relief Model (the `crm` job's saved copy), feathered
    in, so the colors and the lines cover the whole region — no empty patches in deep water.
  • Contour crowding is handled per line piece: on a steep wall the 10 ft lines only appear once you've zoomed in far
    enough for them to sit apart (feature property `minz`; the app has one line layer per zoom step).
  • Its own folder and its own manifest (manifests/bottom2-socal.json, catalog key "bottom2"): the old HD bottom and
    the old contour pictures are untouched, so Admin → Settings → "new_maps" off-switch (or undo.sh) brings them back.
Resumable like bottomhd: progress is saved per zoom-10 block, and the workflow starts the next run by itself.
Blocks nearest San Pedro are drawn first, so LA / Palos Verdes / Catalina look new first.
"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np

from .bottomhd import (AREAS, BUCKET, Surveys, _norm_read, _trim_cache, half, half_res, latest_scheme_key, overview, png,
                       published_style, scheme_tiles, style_tag, tile_bounds_3857)

VERSION = "v7"
AREA = "socal"
TOP_Z, MAX_Z = 10, 14
MANIFEST, KEY = "manifests/bottom2-socal.json", "bottom2"
LAYER = "contours"
EXTENT = 4096
BUFFER = 64                    # tile units drawn past each edge, so lines join the next tile cleanly
GAP_PX = 5.0                   # on screen: lines of the same kind closer than this are held back until you zoom in
LAST_Z = 17                    # pieces that would still be crowded at zoom 17 are left out
CRM_RES_M = 90.0
R = 6378137.0
HOME = (-118.27, 33.70)        # San Pedro: drawn first


# ------------------------------------------------------------------ contour depths per zoom

def vec_levels(z: int) -> list[int]:
    r = lambda a, b, s: list(range(a, b + 1, s))      # noqa: E731
    if z >= 14:
        return r(5, 60, 5) + r(70, 300, 10) + r(350, 1000, 50) + r(1100, 3000, 100) + r(3500, 8000, 500)
    if z == 13:
        return r(10, 100, 10) + r(120, 300, 20) + r(350, 1000, 50) + r(1100, 3000, 100) + r(3500, 8000, 500)
    if z == 12:
        return r(20, 100, 20) + r(150, 300, 50) + r(400, 1000, 100) + r(1250, 3000, 250) + r(3500, 8000, 500)
    if z == 11:
        return [30, 60, 100, 200, 300, 400, 600, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000]
    return [60, 100, 200, 300, 600, 1000, 1500, 2000, 3000, 4000, 5000, 6000]


def is_major(lv: int) -> bool:
    """Bold, labeled lines: every 100 ft to 1,000 ft, then every 500 ft."""
    return (lv <= 1000 and lv % 100 == 0) or lv % 500 == 0


def is_std(lv: int) -> bool:
    """Shown with Contour detail = Standard (Max shows every line)."""
    return lv == 60 or (lv <= 100 and lv % 20 == 0) or (lv <= 300 and lv % 50 == 0) or (lv <= 1000 and lv % 100 == 0) or lv % 500 == 0


def room_ft(lv: int) -> int:
    """Depth step to the next line of the same kind (10 ft lines need 10 ft of room...)."""
    from .contourdraw import importance
    return min(importance(lv), 100)


# ------------------------------------------------------------------ contour lines → vector tile

def _clip_runs(p: np.ndarray, lo: float, hi: float):
    """Pieces of a polyline (tile units) that lie inside the buffered square."""
    inside = (p[:, 0] >= lo) & (p[:, 0] <= hi) & (p[:, 1] >= lo) & (p[:, 1] <= hi)
    out, start = [], None
    for i, ok in enumerate(inside):
        if ok and start is None:
            start = i
        if (not ok or i == len(inside) - 1) and start is not None:
            end = i + 1 if ok else i
            if end - start >= 2:
                out.append(p[start:end])
            start = None
    return out


def _min_zoom(spacing_m: np.ndarray, lat: float) -> np.ndarray:
    """Zoom from which lines `spacing_m` apart sit at least GAP_PX apart on screen (256 px tiles)."""
    m0 = 40075016.685578488 * math.cos(math.radians(lat)) / 256.0      # m per screen px at zoom 0
    with np.errstate(divide="ignore"):
        return np.ceil(np.log2(GAP_PX * m0 / np.maximum(spacing_m, 1e-3)))


def contour_tile(dem: np.ndarray, res: np.ndarray, pad: int, z: int, lat: float, max_z: int = MAX_Z, style: dict | None = None) -> bytes:
    """MVT bytes (b'' = nothing) with this square's depth contours. dem/res: (READ + 2·pad)² elevation m / survey cell m."""
    from scipy import ndimage
    from .contourdraw import _chaikin, trace
    from .hdrender import M_TO_FT, READ, fill_nearest, px_m, resolve, smooth_by_resolution
    st = resolve(style)
    water = np.isfinite(dem) & (dem < 0)
    if not water[pad:pad + READ, pad:pad + READ].any():
        return b""
    pxm = px_m(z, lat)
    raw = np.where(np.isfinite(dem), dem, np.nan)
    dep = ndimage.gaussian_filter(np.clip(-fill_nearest(raw.astype(np.float64)), 0, None), 6, mode="nearest")
    res = np.where(np.isfinite(res), res, 8.0)
    lsm = smooth_by_resolution(raw, np.maximum(res, st["DEEP_LINE"] * dep), pxm, cells=st["LINE_CELLS"])
    depth = np.where(water, np.maximum(-lsm, 0) * M_TO_FT, np.nan)
    off = pad
    if pad == 0:                                        # no margin: repeat the edge so lines reach the square's edge
        depth = np.pad(depth, 1, mode="edge"); off = 1
    slope = None
    if z >= max_z:
        gy, gx = np.gradient(np.where(np.isfinite(depth), depth, 0.0))
        slope = np.hypot(gx, gy) / pxm                  # ft per m
    k = EXTENT / READ
    lo, hi = -BUFFER, EXTENT + BUFFER
    groups: dict = {}
    for lv, lines in trace(depth, [float(v) for v in vec_levels(z)]).items():
        lvi = int(round(lv))
        for p in lines:
            p = _chaikin(np.asarray(p, np.float64), 2)
            if slope is not None:
                yi = np.clip(p[:, 1].round().astype(int), 0, slope.shape[0] - 1)
                xi = np.clip(p[:, 0].round().astype(int), 0, slope.shape[1] - 1)
                mz = _min_zoom(room_ft(lvi) / np.maximum(slope[yi, xi], 1e-6), lat)
                mz = ndimage.maximum_filter1d(np.clip(mz, z, LAST_Z + 1), 9, mode="nearest")   # no flicker of tiny pieces
            else:
                mz = np.full(len(p), z)
            t = (p - off) * k
            for a, b in _runs_by(mz):
                if mz[a] > LAST_Z:
                    continue
                for piece in _clip_runs(t[max(a - 1, 0):b], lo, hi):
                    piece = simplify(piece)
                    groups.setdefault((lvi, int(mz[a])), []).append([(float(x), float(y)) for x, y in piece])
    from .mvt import encode_lines
    feats = [{"lines": ls, "props": {"lv": lv, "major": int(is_major(lv)), "std": int(is_std(lv) or z <= 12), "minz": mz}}
             for (lv, mz), ls in sorted(groups.items())]
    return encode_lines(LAYER, feats, EXTENT)


SIMPLIFY = 1.5                 # tile units (1/4096 of a square): invisible even zoomed in 8×, keeps files small


def simplify(p: np.ndarray, tol: float = SIMPLIFY) -> np.ndarray:
    """Douglas–Peucker: drop points that sit within `tol` of the straight line between their neighbours."""
    if len(p) < 3:
        return p
    keep = np.zeros(len(p), bool); keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        seg = p[b] - p[a]
        L = math.hypot(seg[0], seg[1])
        mid = p[a + 1:b] - p[a]
        d = np.abs(mid[:, 0] * seg[1] - mid[:, 1] * seg[0]) / L if L > 1e-9 else np.hypot(mid[:, 0], mid[:, 1])
        i = int(np.argmax(d))
        if d[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack += [(a, m), (m, b)]
    return p[keep]


def _runs_by(v: np.ndarray):
    """(start, end) of runs of equal values."""
    out, s = [], 0
    for i in range(1, len(v) + 1):
        if i == len(v) or v[i] != v[s]:
            out.append((s, i)); s = i
    return out


# ------------------------------------------------------------------ filling survey gaps from the Coastal Relief Model

class CrmFill:
    """NOAA's Coastal Relief Model (saved by the `crm` job), read onto map squares to fill BlueTopo gaps."""

    def __init__(self, grid):
        self.g = grid
        self.v = np.nan_to_num(grid.values.astype(np.float32), nan=1.0)     # no data counts as land

    @classmethod
    def load(cls, store, log=print):
        try:
            raw = store.get("work/crm/socal.npz")
        except Exception:
            raw = None
        if not raw:
            log("bottom2: no saved Coastal Relief Model (run the `crm` job once) — survey gaps stay empty")
            return None
        from .crm import from_npz
        return cls(from_npz(raw))

    def square(self, z: int, x: int, y: int, size: int, margin: int) -> np.ndarray:
        from scipy.ndimage import map_coordinates
        full = size + 2 * margin
        x0, y0, x1, y1 = tile_bounds_3857(z, x, y)
        step = (x1 - x0) / size
        xs = x0 - margin * step + (np.arange(full) + 0.5) * step
        ys = y1 + margin * step - (np.arange(full) + 0.5) * step
        lon = np.degrees(xs / R)
        lat = np.degrees(np.arctan(np.sinh(ys / R)))
        g = self.g
        fi = (lat - g.lats[0]) / (g.lats[1] - g.lats[0])
        fj = (lon - g.lons[0]) / (g.lons[1] - g.lons[0])
        FI, FJ = np.meshgrid(fi, fj, indexing="ij")
        v = map_coordinates(self.v, [FI, FJ], order=1, mode="nearest")
        outside = (FI < 0) | (FI > g.lats.size - 1) | (FJ < 0) | (FJ > g.lons.size - 1)
        return np.where(outside, np.nan, v).astype(np.float32)


def fill_gaps(dem: np.ndarray, res: np.ndarray, crm: np.ndarray, pxm: float):
    """BlueTopo (dem, res) + model depths: model fills the holes, feathered into the survey over a few model cells."""
    from scipy import ndimage
    have = np.isfinite(dem)
    add = ~have & np.isfinite(crm)
    if not add.any():
        return dem, res
    add_w = add & (crm < 0)
    dem, res = dem.copy(), np.where(np.isfinite(res), res, np.nan).copy()
    if add_w.any() and have.any():
        band = max(6.0, 2.0 * CRM_RES_M / pxm)
        d = ndimage.distance_transform_edt(~add_w)
        wf = np.clip(d / band, 0, 1).astype(np.float32)
        mix = have & np.isfinite(crm) & (crm < 0) & (wf < 1)
        dem[mix] = wf[mix] * dem[mix] + (1 - wf[mix]) * crm[mix]
        res[mix] = wf[mix] * np.nan_to_num(res[mix], nan=8.0) + (1 - wf[mix]) * CRM_RES_M
    dem[add] = crm[add]
    res[add] = CRM_RES_M
    return dem.astype(np.float32), res.astype(np.float32)


# ------------------------------------------------------------------ drawing a block

def build_tree(read_square, put, z: int, x: int, y: int, bbox: tuple, stats: dict, max_z: int = MAX_Z, style: dict | None = None):
    """Draw square (z, x, y) and everything under it to max_z: a smooth picture (no lines) + a contour vector tile.
    Returns the square's (depth m, survey cell m) at READ px for the zoom above."""
    from .hdrender import READ, draw
    from .tiles import tile_bounds
    w, s, e, n = tile_bounds(z, x, y)
    lat = (s + n) / 2
    if e < bbox[0] or w > bbox[2] or n < bbox[1] or s > bbox[3]:
        return np.full((READ, READ), np.nan, np.float32), np.full((READ, READ), np.nan, np.float32)
    if z == max_z:
        dem_p, res_p, pad = _norm_read(read_square(z, x, y))
        core = (slice(pad, pad + READ), slice(pad, pad + READ))
        dem, res = dem_p[core], res_p[core]
    else:
        q = [build_tree(read_square, put, z + 1, 2 * x + dx, 2 * y + dy, bbox, stats, max_z, style) for dy in (0, 1) for dx in (0, 1)]
        dem_p = dem = half(np.block([[q[0][0], q[1][0]], [q[2][0], q[3][0]]]))
        res_p = res = half_res(np.block([[q[0][1], q[1][1]], [q[2][1], q[3][1]]]))
        pad = 0
    img = draw(dem_p, res_p, z, lat, pad, lines=False, style=style)
    if img is not None:
        put(f"{z}/{x}/{y}.png", png(img), "image/png"); stats["tiles"] += 1
        pbf = contour_tile(dem_p, res_p, pad, z, lat, max_z, style)
        if pbf:
            put(f"c/{z}/{x}/{y}.pbf", pbf, "application/x-protobuf"); stats["lines"] += 1
    return dem, res


def reader(surveys, crm: CrmFill | None):
    """read_square(z, x, y) → (depth m, cell m) with margin: BlueTopo first, model in the gaps."""
    from .hdrender import MARGIN, READ
    from .tiles import tile_bounds

    def read(z, x, y):
        full = READ + 2 * MARGIN
        if surveys is not None:
            dem, res = surveys.square(z, x, y)
        else:
            dem = np.full((full, full), np.nan, np.float32); res = dem.copy()
        if crm is not None:
            w, s, e, n = tile_bounds(z, x, y)
            from .hdrender import px_m
            dem, res = fill_gaps(dem, res, crm.square(z, x, y, READ, MARGIN), px_m(z, (s + n) / 2))
        return dem, res
    return read


def order_blocks(tops: list) -> list:
    """Nearest San Pedro first."""
    from .tiles import tile_bounds

    def dist(t):
        w, s, e, n = tile_bounds(*t)
        return ((w + e) / 2 - HOME[0]) ** 2 + ((s + n) / 2 - HOME[1]) ** 2
    return sorted(tops, key=dist)


def manifest(store, base: str, stamp: str, done: int, total: int, tag: str) -> dict:
    url = store.url(base)
    return {"key": KEY, "label": "HD bottom", "tiles": url + "/{z}/{x}/{y}.png?v=" + stamp, "minzoom": 6, "maxzoom": MAX_Z,
            "contours": url + "/c/{z}/{x}/{y}.pbf?v=" + stamp, "contour_minzoom": TOP_Z, "contour_maxzoom": MAX_Z, "contour_layer": LAYER,
            "areas": {AREA: list(AREAS[AREA])}, "complete": done >= total, "progress": f"{done}/{total}", "style": VERSION + tag,
            "built_at": datetime.now(timezone.utc).isoformat(), "source": "NOAA BlueTopo + NOAA Coastal Relief Model",
            "note": "Seafloor detail from NOAA surveys. For fishing, not navigation."}


def run(store, http, log=print, budget_s: float = 48 * 60, force: bool = False):
    from .tiles import tile_bounds, tiles_for_bbox
    t0 = time.time()
    if os.path.exists("bottomhd-continue.txt"):
        os.unlink("bottomhd-continue.txt")
    bbox = AREAS[AREA]
    style = published_style(http, log)
    tag = style_tag(style)
    base = f"tiles/bottom2/{AREA}/{VERSION}{tag}"
    work_key = f"work/bottom2/{AREA}/{VERSION}{tag}/done.json"
    done = set() if force else set(json.loads(store.get(work_key) or b"[]"))
    key = latest_scheme_key(http)
    r = http.get(f"{BUCKET}/{key}"); r.raise_for_status()
    items = scheme_tiles(r.content, bbox)
    log(f"bottom2: {len(items)} BlueTopo survey tiles cover SoCal (zoom {TOP_Z}–{MAX_Z}, smooth pictures + vector contour lines)")
    crm = CrmFill.load(store, log)
    if not items and crm is None:
        raise RuntimeError("no BlueTopo coverage and no saved relief model — nothing to draw")
    folder = tempfile.mkdtemp(prefix="bluetopo2-")
    pool = ThreadPoolExecutor(max_workers=8)
    pending = []
    put = lambda k, data, ctype: pending.append(pool.submit(store.put, f"{base}/{k}", data, ctype))   # noqa: E731
    stats = {"tiles": 0, "lines": 0}
    tops = order_blocks(list(tiles_for_bbox(bbox, TOP_Z)))
    for (z, x, y) in tops:
        k = f"{z}/{x}/{y}"
        if k in done:
            continue
        if time.time() - t0 > budget_s:
            log("bottom2: time's up for this run — saving progress (it continues in the next run)")
            break
        w, s_, e, n = tile_bounds(z, x, y)
        mg = (e - w) * 0.05
        here = [it for it in items if not (it["bounds"][2] < w - mg or it["bounds"][0] > e + mg or it["bounds"][3] < s_ - mg or it["bounds"][1] > n + mg)]
        surveys = None
        if here:
            _trim_cache(folder, {re.sub(r"[^\w.-]", "_", it["tile"]) + ".tif" for it in here}, log)
            surveys = Surveys(here, folder, http, log)
        if surveys is not None or crm is not None:
            build_tree(reader(surveys, crm), put, z, x, y, bbox, stats, MAX_Z, style)
        if surveys is not None:
            surveys.close()
        for f in pending:
            f.result()
        pending.clear()
        done.add(k)
        store.put(work_key, json.dumps(sorted(done)).encode(), "application/json")
        log(f"bottom2: block {k} done — {stats['tiles']} pictures, {stats['lines']} contour tiles so far ({len(done)}/{len(tops)} blocks)")
    pool.shutdown(wait=True)
    complete = all(f"{z}/{x}/{y}" in done for (z, x, y) in tops)
    if not complete:
        with open("bottomhd-continue.txt", "w") as fh:          # the workflow sees this and starts the next run itself
            fh.write(AREA)
    if complete:
        overview(store, base, bbox, TOP_Z, log=log)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    store.put(MANIFEST, json.dumps(manifest(store, base, stamp, len(done), len(tops), tag)).encode(), "application/json")
    log(f"bottom2: saved — {len(done)}/{len(tops)} blocks" + ("" if complete else
        " (continuing in the next run; until it's done the app shows the new bottom where it's drawn and the old one elsewhere,"
        " and keeps the old contour lines)"))
