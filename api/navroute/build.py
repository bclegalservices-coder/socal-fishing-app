"""python -m ocean.jobs navmask  — builds the water map for auto routing (see grid.py), from NOAA's own charts.

For every ~5 km tile that has coast in it, at ~10 m detail:
  • the most detailed NOAA electronic chart that covers each spot wins: berthing → harbour → approach → coastal
    (so a marina's slips and fairways come from the berthing/harbour chart, open coast from the coastal chart).
    A chart "covers" a spot where it has either a Land Area or a Depth Area there;
  • Land Area = land; Depth Area / Dredged Area give the charted depth (DRVAL1, the shallow end, in feet);
  • Shoreline Construction, Pontoons, Floating Docks and Hulks from every chart (breakwaters, jetties, piers,
    sea walls, marina docks) are drawn in as obstacles;
  • anywhere no chart covers (e.g. Mexico) falls back to the ~100 m land mask the water-temperature map uses.
Chart layers are looked up by name in each NOAA service, so a renumbered service doesn't break the job.

The job is resumable: it saves each tile as it goes and stops cleanly before GitHub's time limit; running it again
continues where it left off (`--force` rebuilds everything). The router uses whatever is built so far.
"""
from __future__ import annotations

import io
import json
import os
import re
import time
from datetime import datetime, timezone

import numpy as np

from .grid import CRES, FINE, FRES, K, LAND, N, PREFIX, TILE, UNKNOWN, WATER, pack, unpack

BLOCK = 5                      # tiles per side fetched together from NOAA (0.25°)
SCALES = ["enc_berthing", ("enc_harbour", "enc_harbor"), "enc_approach", "enc_coastal"]   # most detailed first (either spelling)
M_TO_FT = 3.28084


# ------------------------------------------------------------------ NOAA chart service

def service_root() -> str:
    url = os.environ.get("ENC_SERVICE_URL") or "https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer"
    return url.split("/enc_")[0]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", (s or "").lower())


def discover(http, log=print) -> list[dict]:
    """For each chart scale: the layer ids for land, depth areas, dredged areas and shoreline construction."""
    root = service_root()
    out = []
    for entry in SCALES:
        names = entry if isinstance(entry, tuple) else (entry,)
        layers, base, svc = [], "", names[0]
        for svc in names:
            base = f"{root}/{svc}/MapServer"
            try:
                r = http.get(f"{base}/layers", params={"f": "json"})
                r.raise_for_status()
                j = r.json()
                if "error" in j:                         # ArcGIS answers 200 + {"error": …} for a wrong service name
                    log(f"navmask: {svc}: NOAA says {str(j['error'])[:150]}")
                    continue
                layers = j.get("layers", [])
                if layers:
                    break
                log(f"navmask: {svc}: no layers listed")
            except Exception as e:
                log(f"navmask: {svc} not reachable ({str(e)[:120]})")
        if not layers:
            continue
        found = {"land": [], "depth": [], "dredged": [], "shore": []}
        for L in layers:
            n, gt = _norm(L.get("name")), L.get("geometryType", "")
            if L.get("type") not in (None, "Feature Layer"):
                continue
            if "landarea" in n and "Polygon" in gt:
                found["land"].append(L["id"])
            elif "deptharea" in n and "Polygon" in gt:
                found["depth"].append(L["id"])
            elif "dredgedarea" in n and "Polygon" in gt:
                found["dredged"].append(L["id"])
            elif any(k in n for k in ("shorelineconstruction", "pontoon", "floatingdock", "hulk")) and ("Polyline" in gt or "Polygon" in gt):
                found["shore"].append((L["id"], gt))
        if not (found["land"] or found["depth"]):
            log(f"navmask: {svc}: no land/depth layers matched — first names: {[L.get('name') for L in layers[:12]]}")
        if found["land"] or found["depth"]:
            out.append({"scale": svc, "base": base, **found})
            log(f"navmask: {svc}: land {found['land']}, depth {found['depth']}, dredged {found['dredged']}, shore {[i for i, _ in found['shore']]}")
    return out


def query(http, base: str, layer: int, bbox: tuple, log=print) -> list[dict]:
    """All features of one layer inside bbox as GeoJSON features (geometry simplified to ~5 m)."""
    lon0, lat0, lon1, lat1 = bbox
    feats, offset = [], 0
    for _ in range(200):
        r = http.get(f"{base}/{layer}/query", params={
            "where": "1=1", "geometry": f"{lon0},{lat0},{lon1},{lat1}", "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
            "returnGeometry": "true", "maxAllowableOffset": FRES / 2, "resultOffset": offset, "resultRecordCount": 1000, "f": "geojson"})
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(str(j["error"])[:150])
        got = j.get("features", [])
        feats += [f for f in got if f.get("geometry")]
        if not got or not (j.get("exceededTransferLimit") or j.get("properties", {}).get("exceededTransferLimit")):
            break
        offset += len(got)
    return feats


def drval1_ft(props: dict) -> int:
    """Shallow end of a depth area, in feet (1–254), or UNKNOWN."""
    for k, v in (props or {}).items():
        if k.lower() == "drval1" and v is not None:
            try:
                m = float(v)
            except (TypeError, ValueError):
                return UNKNOWN
            return int(np.clip(round(max(m, 0.0) * M_TO_FT), 0, 254)) or 1 if m > 0 else 0
    return UNKNOWN


# ------------------------------------------------------------------ drawing

class Canvas:
    """A block of the fine grid to draw chart shapes into (row 0 = north while drawing)."""

    def __init__(self, bbox: tuple):
        self.lon0, self.lat0, self.lon1, self.lat1 = bbox
        self.w = int(round((self.lon1 - self.lon0) / FRES)); self.h = int(round((self.lat1 - self.lat0) / FRES))

    def px(self, lon, lat):
        return ((lon - self.lon0) / FRES, (self.lat1 - lat) / FRES)

    def polys(self, feats: list, value_of=lambda f: 1, mode="L", fill_holes=0) -> np.ndarray:
        from PIL import Image, ImageDraw
        img = Image.new(mode, (self.w, self.h), 0)
        d = ImageDraw.Draw(img)
        def area(f):
            c = f["geometry"].get("coordinates") or []
            rings = [c[0]] if f["geometry"]["type"] == "Polygon" and c else [p[0] for p in c if p] if f["geometry"]["type"] == "MultiPolygon" else []
            s = 0.0
            for r in rings:
                xs = [p[0] for p in r]; ys = [p[1] for p in r]
                s += (max(xs) - min(xs)) * (max(ys) - min(ys)) if r else 0
            return s
        for f in sorted(feats, key=area, reverse=True):            # big first: smaller shapes inside holes win
            g = f["geometry"]; t, c = g.get("type"), g.get("coordinates") or []
            parts = [c] if t == "Polygon" else c if t == "MultiPolygon" else []
            val = value_of(f)
            for rings in parts:
                if not rings or len(rings[0]) < 3:
                    continue
                d.polygon([self.px(x, y) for x, y in rings[0]], fill=val, outline=val)
                for hole in rings[1:]:
                    if len(hole) >= 3:
                        d.polygon([self.px(x, y) for x, y in hole], fill=fill_holes)
        return np.array(img)

    def lines(self, feats: list, width: int = 2) -> np.ndarray:
        from PIL import Image, ImageDraw
        img = Image.new("1", (self.w, self.h), 0)
        d = ImageDraw.Draw(img)
        for f in feats:
            g = f["geometry"]; t, c = g.get("type"), g.get("coordinates") or []
            for ln in ([c] if t == "LineString" else c if t == "MultiLineString" else []):
                if len(ln) >= 2:
                    d.line([self.px(x, y) for x, y in ln], fill=1, width=width)
        return np.array(img, dtype=bool)


def block_from_charts(canvas: Canvas, charts: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """charts: per scale (most detailed first) dict of feature lists: land, depth, dredged, shore_lines, shore_polys.
    Returns (water, depth_ft, covered) for the block, row 0 = SOUTH edge."""
    h, w = canvas.h, canvas.w
    decided = np.zeros((h, w), dtype=bool)
    land = np.zeros((h, w), dtype=bool)
    depth = np.full((h, w), UNKNOWN, dtype=np.uint8)
    obstacles = np.zeros((h, w), dtype=bool)
    for c in charts:
        L = canvas.polys(c.get("land", [])).astype(bool) if c.get("land") else np.zeros((h, w), bool)
        D = canvas.polys(c.get("depth", []), value_of=lambda f: max(1, drval1_ft(f.get("properties")) or 1)) if c.get("depth") else np.zeros((h, w), np.uint8)
        if c.get("dredged"):
            R = canvas.polys(c["dredged"], value_of=lambda f: max(1, drval1_ft(f.get("properties")) or 1))
            D = np.where(R > 0, R, D)
        cov = L | (D > 0)
        take = cov & ~decided
        land[take] = L[take]
        depth[take & ~L] = D[take & ~L]
        decided |= cov
        if c.get("shore_lines"):
            obstacles |= canvas.lines(c["shore_lines"], width=2)
        if c.get("shore_polys"):
            obstacles |= canvas.polys(c["shore_polys"]).astype(bool)
    water = decided & ~land & ~obstacles
    depth[~water] = np.where(decided[~water], 0, UNKNOWN)
    return water[::-1].copy(), depth[::-1].copy(), decided[::-1].copy()


# ------------------------------------------------------------------ the job

def tile_kinds(lm, bbox: tuple) -> np.ndarray:
    """From the ~100 m land mask: which tiles are open water, solid land, or have coast (need fine detail)."""
    from scipy import ndimage
    lon0, lat0, lon1, lat1 = bbox
    nt_i = int(round((lat1 - lat0) / TILE)); nt_j = int(round((lon1 - lon0) / TILE))
    kinds = np.full((nt_i, nt_j), FINE, dtype=np.uint8)
    if lm is None:
        return kinds
    land = ndimage.binary_dilation(lm.land, iterations=3)       # a little margin so no coast slips through
    water = ndimage.binary_dilation(~lm.land, iterations=3)
    per = int(round(TILE / lm.res))
    for i in range(nt_i):
        for j in range(nt_j):
            a = land[i * per:(i + 1) * per, j * per:(j + 1) * per]
            b = water[i * per:(i + 1) * per, j * per:(j + 1) * per]
            if a.size == 0:
                continue
            if not a.any():
                kinds[i, j] = WATER
            elif not b.any():
                kinds[i, j] = LAND
    return kinds


def coarse_from(kinds: np.ndarray, tiles: dict, lm, bbox: tuple) -> tuple[np.ndarray, np.ndarray]:
    """The ~200 m grid: water only where every fine cell inside is water; depth = shallowest inside."""
    per = N // K
    H, W = kinds.shape[0] * per, kinds.shape[1] * per
    cw = np.ones((H, W), dtype=bool); cd = np.full((H, W), UNKNOWN, dtype=np.uint8)
    for i in range(kinds.shape[0]):
        for j in range(kinds.shape[1]):
            sl = (slice(i * per, (i + 1) * per), slice(j * per, (j + 1) * per))
            k = kinds[i, j]
            if k == LAND:
                cw[sl] = False; cd[sl] = 0
            elif k == FINE:
                t = tiles.get((i, j))
                if t is not None:
                    w, d = t
                    cw[sl] = w.reshape(per, K, per, K).all(axis=(1, 3))
                    cd[sl] = d.reshape(per, K, per, K).min(axis=(1, 3))
                elif lm is not None:                          # not built yet: from the 100 m mask
                    r = int(round(CRES / lm.res))
                    m = lm.land[i * per * r:(i + 1) * per * r, j * per * r:(j + 1) * per * r]
                    if m.shape == (per * r, per * r):
                        cw[sl] = ~m.reshape(per, r, per, r).any(axis=(1, 3))
                        cd[sl] = np.where(cw[sl], UNKNOWN, 0)
    return cw, cd


def save(store, bbox, kinds, tiles_done: dict, lm, sources: list, complete: bool, log=print):
    cw, cd = coarse_from(kinds, tiles_done, lm, bbox)
    buf = io.BytesIO(); np.savez_compressed(buf, kinds=kinds)
    store.put(f"{PREFIX}/kinds.npz", buf.getvalue(), "application/octet-stream")
    store.put(f"{PREFIX}/coarse.npz", pack(cw, cd), "application/octet-stream")
    meta = {"bbox": list(bbox), "tile": TILE, "fres": FRES, "cres": CRES, "built_at": datetime.now(timezone.utc).isoformat(),
            "fine_tiles": int((kinds == FINE).sum()), "fine_built": len(tiles_done), "complete": complete, "sources": sources}
    store.put(f"{PREFIX}/meta.json", json.dumps(meta).encode(), "application/json")
    log(f"navmask: saved — {len(tiles_done)}/{meta['fine_tiles']} coastal tiles at ~10 m{'' if complete else ' (run again to continue)'}")


def save_arrays(store, bbox: tuple, water: np.ndarray, depth: np.ndarray):
    """Write a whole water map from full-size arrays (row 0 = south). Used by tests and small regions."""
    nt_i = water.shape[0] // N; nt_j = water.shape[1] // N
    kinds = np.zeros((nt_i, nt_j), dtype=np.uint8); tiles = {}
    for i in range(nt_i):
        for j in range(nt_j):
            w = water[i * N:(i + 1) * N, j * N:(j + 1) * N]; d = depth[i * N:(i + 1) * N, j * N:(j + 1) * N]
            if w.all() and (d == UNKNOWN).all():
                kinds[i, j] = WATER
            elif not w.any():
                kinds[i, j] = LAND
            else:
                kinds[i, j] = FINE; tiles[(i, j)] = (w, d)
                store.put(f"{PREFIX}/t/{i}_{j}.npz", pack(w, d), "application/octet-stream")
    save(store, bbox, kinds, tiles, None, ["test arrays"], True, log=lambda *_: None)


def run(store, bbox: tuple, region: str, http, log=print, budget_s: float = 42 * 60, force: bool = False):
    from ocean import landmask
    t_start = time.time()
    lm = landmask.get(region, bbox, store, http, log)
    kinds = tile_kinds(lm, bbox)
    charts = discover(http, log)
    if not charts:
        raise RuntimeError("no NOAA chart service answered")
    tiles_done: dict = {}
    if not force:                                             # resume: keep what earlier runs built
        for i, j in zip(*np.nonzero(kinds == FINE)):
            raw = store.get(f"{PREFIX}/t/{i}_{j}.npz")
            if raw:
                tiles_done[(int(i), int(j))] = unpack(raw)
    todo_blocks = sorted({(int(i) // BLOCK, int(j) // BLOCK) for i, j in zip(*np.nonzero(kinds == FINE)) if (int(i), int(j)) not in tiles_done})
    log(f"navmask: {int((kinds == FINE).sum())} coastal tiles, {len(tiles_done)} already built, {len(todo_blocks)} blocks to fetch")
    lon0, lat0 = bbox[0], bbox[1]
    stopped = False
    for bi, bj in todo_blocks:
        if time.time() - t_start > budget_s:
            stopped = True
            log("navmask: time's up for this run — saving progress")
            break
        bb = (lon0 + bj * BLOCK * TILE, lat0 + bi * BLOCK * TILE, lon0 + (bj + 1) * BLOCK * TILE, lat0 + (bi + 1) * BLOCK * TILE)
        per_scale = []
        for c in charts:
            got = {}
            try:
                for key in ("land", "depth", "dredged"):
                    got[key] = [f for lid in c[key] for f in query(http, c["base"], lid, bb, log)]
                lines, polys = [], []
                for lid, gt in c["shore"]:
                    (polys if "Polygon" in gt else lines).extend(query(http, c["base"], lid, bb, log))
                got["shore_lines"], got["shore_polys"] = lines, polys
            except Exception as e:
                log(f"navmask: {c['scale']} block {bi},{bj} failed ({str(e)[:120]}) — using the other charts there")
                continue
            if any(got.values()):
                per_scale.append(got)
        canvas = Canvas(bb)
        water, depth, covered = block_from_charts(canvas, per_scale)
        # anywhere no chart reaches: the ~100 m land mask
        if lm is not None and not covered.all():
            gi = ((np.arange(canvas.h) + 0.5) * FRES + bb[1] - lm.lat0) / lm.res
            gj = ((np.arange(canvas.w) + 0.5) * FRES + bb[0] - lm.lon0) / lm.res
            ii = np.clip(gi.astype(int), 0, lm.land.shape[0] - 1); jj = np.clip(gj.astype(int), 0, lm.land.shape[1] - 1)
            rough_land = lm.land[np.ix_(ii, jj)]
            water = np.where(covered, water, ~rough_land)
            depth = np.where(covered, depth, np.where(rough_land, 0, UNKNOWN)).astype(np.uint8)
        for di in range(BLOCK):
            for dj in range(BLOCK):
                i, j = bi * BLOCK + di, bj * BLOCK + dj
                if i >= kinds.shape[0] or j >= kinds.shape[1] or kinds[i, j] != FINE:
                    continue
                w = water[di * N:(di + 1) * N, dj * N:(dj + 1) * N]; d = depth[di * N:(di + 1) * N, dj * N:(dj + 1) * N]
                store.put(f"{PREFIX}/t/{i}_{j}.npz", pack(w, d), "application/octet-stream")
                tiles_done[(i, j)] = (w, d)
        log(f"navmask: block {bi},{bj} done ({len(per_scale)} charts) — {len(tiles_done)} tiles")
    save(store, bbox, kinds, tiles_done, lm, [c["scale"] for c in charts], complete=not stopped, log=log)
