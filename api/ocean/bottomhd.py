"""python -m ocean.jobs bottomhd [--area pilot]  — "HD bottom": Navionics-style sharp seafloor relief with dense
contour lines, from NOAA BlueTopo (NOAA's best-available bathymetry compilation, multibeam surveys where they exist:
roughly 2–16 m detail). Free and public: https://nauticalcharts.noaa.gov/data/bluetopo_specs.html

How it's made:
  1. Read NOAA's BlueTopo tile index (a GeoPackage in NOAA's public AWS bucket) and pick the survey tiles that cover
     the area. Download those GeoTIFFs (depth in meters).
  2. For every ~zoom-16 map square (about 300 m across) resample the survey depths onto the square (finest survey
     first). Lower zooms are made by averaging four squares into one, all the way up to zoom 11 — so each survey
     file is read only once.
  3. Draw each square: depth colors (yellow-green shallows → deep blue), relief shading lit from four directions so
     rocks, ledges and canyon walls stand out, and dense contour lines (every 5 ft to 60 ft, every 10 ft to 300 ft,
     then every 50 ft when zoomed in; fewer when zoomed out), bolder every 100 ft. Land and no-data are transparent.
Resumable: progress is saved per ~20 km block; running again continues (`--force` redraws everything).
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import sqlite3
import struct
import tempfile
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np

BUCKET = "https://noaa-ocs-nationalbathymetry-pds.s3.amazonaws.com"
SCHEME_PREFIX = "BlueTopo/_BlueTopo_Tile_Scheme/"
AREAS = {
    # Pilot: Santa Catalina Island, Palos Verdes, the Port of LA / Long Beach and the San Pedro Channel.
    "pilot": (-118.65, 33.25, -118.05, 33.85),
}
TOP_Z, MAX_Z = 11, 16
HD_VERSION = "v4"            # Oct 24: smooth chart-style lines at 512 px (see contourdraw.py)
SIZE = 256
M_TO_FT = 3.28084
EARTH = 40075016.685578488


# ------------------------------------------------------------------ BlueTopo tile index

def latest_scheme_key(http) -> str:
    r = http.get(f"{BUCKET}/", params={"list-type": "2", "prefix": SCHEME_PREFIX})
    r.raise_for_status()
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    keys = [k.text for k in ET.fromstring(r.content).findall(".//s3:Contents/s3:Key", ns)]
    keys = [k for k in keys if k and k.lower().endswith(".gpkg")]
    if not keys:
        raise RuntimeError("BlueTopo tile index not found in NOAA's bucket")
    return sorted(keys)[-1]                       # names carry the date, so the last one is the newest


def gpkg_bounds(blob: bytes) -> tuple[float, float, float, float] | None:
    """(minx, miny, maxx, maxy) of a GeoPackage geometry, from its header envelope or its WKB polygon."""
    if not blob or blob[:2] != b"GP":
        return None
    flags = blob[3]
    le = flags & 1
    env = (flags >> 1) & 0b111
    end = "<" if le else ">"
    n = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}.get(env, 0)
    if n:
        v = struct.unpack(end + "d" * n, blob[8:8 + 8 * n])
        return (v[0], v[2], v[1], v[3])
    wkb = blob[8:]
    xs, ys = [], []                               # no envelope: walk the polygon's coordinates
    bo = "<" if wkb[0] == 1 else ">"
    gtype = struct.unpack(bo + "I", wkb[1:5])[0] % 1000
    off = 5
    def ring(o):
        k = struct.unpack(bo + "I", wkb[o:o + 4])[0]; o += 4
        for _ in range(k):
            x, y = struct.unpack(bo + "dd", wkb[o:o + 16]); xs.append(x); ys.append(y); o += 16
        return o
    if gtype == 3:
        nr = struct.unpack(bo + "I", wkb[off:off + 4])[0]; off += 4
        for _ in range(nr):
            off = ring(off)
    elif gtype == 6:
        npoly = struct.unpack(bo + "I", wkb[off:off + 4])[0]; off += 4
        for _ in range(npoly):
            off += 5
            nr = struct.unpack(bo + "I", wkb[off:off + 4])[0]; off += 4
            for _ in range(nr):
                off = ring(off)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def scheme_tiles(gpkg: bytes, bbox: tuple) -> list[dict]:
    """BlueTopo tiles that overlap bbox and have a GeoTIFF: [{tile, url, res_m, bounds}] — finest first."""
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as f:
        f.write(gpkg); path = f.name
    try:
        con = sqlite3.connect(path)
        table, geom = con.execute("select table_name, column_name from gpkg_geometry_columns").fetchone()
        cols = [r[1] for r in con.execute(f'pragma table_info("{table}")')]
        low = {c.lower(): c for c in cols}
        link = next((low[c] for c in low if "geotiff" in c and "link" in c), None)
        res = next((low[c] for c in low if c.startswith("resolution")), None)
        name = low.get("tile") or low.get("tile_id") or cols[0]
        if not link:
            raise RuntimeError(f"BlueTopo index has no GeoTIFF link column (columns: {cols})")
        out = []
        res_sql = f'"{res}"' if res else "NULL"
        for row in con.execute(f'select "{name}", "{link}", {res_sql}, "{geom}" from "{table}"'):
            t, url, r, blob = row
            if not url:
                continue
            b = gpkg_bounds(blob)
            if not b or b[2] < bbox[0] or b[0] > bbox[2] or b[3] < bbox[1] or b[1] > bbox[3]:
                continue
            m = re.search(r"[\d.]+", str(r or ""))
            out.append({"tile": str(t), "url": link_url(url), "res_m": float(m.group()) if m else 99.0, "bounds": b})
        con.close()
        return sorted(out, key=lambda d: d["res_m"])
    finally:
        os.unlink(path)


def link_url(u: str) -> str:
    u = u.strip()
    if u.startswith("s3://"):
        b, _, k = u[5:].partition("/")
        return f"https://{b}.s3.amazonaws.com/{k}"
    if u.startswith("http"):
        return u
    return f"{BUCKET}/{u.lstrip('/')}"


# ------------------------------------------------------------------ drawing

DEPTH_STOPS_FT = [0, 6, 15, 30, 60, 120, 250, 500, 1000, 3000]
DEPTH_COLORS = np.array([
    [236, 226, 128], [205, 228, 122], [160, 220, 140], [104, 206, 178], [70, 186, 210],
    [48, 156, 214], [40, 130, 202], [34, 108, 182], [30, 90, 160], [28, 76, 140]], dtype=np.float64)   # Oct 24: deep water lighter (was near-black once shaded)


def levels_for(z: int) -> tuple[np.ndarray, set]:
    """Contour depths (ft) for a zoom, and which of them are drawn bold (see contourtiles.levels)."""
    from .contourtiles import levels
    return levels("hd", z)


def draw(dem_m: np.ndarray, z: int, lat: float) -> np.ndarray | None:
    """RGBA (SIZE×SIZE) from elevation in meters (negative = under water, NaN = no data). None = nothing to draw."""
    from scipy import ndimage
    water = np.isfinite(dem_m) & (dem_m < 0)
    if not water.any():
        return None
    depth_ft = np.where(water, -dem_m * M_TO_FT, 0.0)
    # relief shading (fill gaps with the nearest depth so the edges don't shade oddly)
    filled = dem_m.copy()
    bad = ~np.isfinite(filled)
    if bad.any():
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        filled = filled[tuple(idx)]
    px_m = EARTH / (2 ** z) / SIZE * math.cos(math.radians(lat))
    zf = 4.0 if z >= 15 else 6.0 if z >= 13 else 9.0           # exaggerated like Navionics; more when zoomed out
    gy, gx = np.gradient(filled * zf, px_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    alt = math.radians(40)
    hs = np.zeros_like(filled)
    for az_deg, w in ((315, 0.4), (270, 0.2), (360, 0.2), (225, 0.2)):   # multi-direction: no "blind" sides
        az = math.radians(360 - az_deg + 90)
        hs += w * (math.sin(alt) * np.cos(slope) + math.cos(alt) * np.sin(slope) * np.cos(az - aspect))
    hs = np.clip(hs, 0, 1)
    # depth colors, shaded
    rgb = np.empty(depth_ft.shape + (3,))
    for c in range(3):
        rgb[..., c] = np.interp(depth_ft, DEPTH_STOPS_FT, DEPTH_COLORS[:, c])
    rgb *= (0.5 + 0.7 * hs)[..., None]                      # light/shadow so rocks and ledges pop (softer since Oct 24)
    # contour lines (shared with the region-wide contour layer)
    from .contourtiles import contour_pixels
    out = np.zeros(depth_ft.shape + (4,), dtype=np.uint8)
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(water, 255, 0)
    return hd_lines(out, dem_m, z, lat)


def hd_lines(shaded: np.ndarray, dem_m: np.ndarray, z: int, lat: float) -> np.ndarray:
    """Oct 24 (v3): smooth chart-style contour lines (contourdraw.py) drawn over the shaded square at 512 px, instead of
    the old pixel-step lines. Returns RGBA 512×512."""
    from PIL import Image
    from scipy import ndimage
    from .contourdraw import PAD, SCALE, blur_sigma_px, render, smooth_tile_depth
    n = SIZE * SCALE
    base = np.array(Image.fromarray(shaded, "RGBA").resize((n, n), Image.BILINEAR))
    depth = np.where(np.isfinite(dem_m) & (dem_m < 0), -dem_m * M_TO_FT, np.nan).astype(np.float64)
    pad = PAD // SCALE
    big = np.pad(depth, pad, mode="edge")
    wet = np.isfinite(big)
    filled = np.where(wet, big, 0.0)
    up = ndimage.zoom(filled, SCALE, order=3)
    upw = ndimage.zoom(wet.astype(np.float32), SCALE, order=1) > 0.5
    d = np.where(upw & (up > 0), up, np.nan)
    d = smooth_tile_depth(d, blur_sigma_px(z, 8.0, lat))
    img = render(d, z, "hd", base=base, labels=z >= 14)
    return img if img is not None else base


def png(rgba: np.ndarray) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def half(a: np.ndarray) -> np.ndarray:
    """2×2 average ignoring NaN (512×512 → 256×256)."""
    h, w = a.shape
    b = a.reshape(h // 2, 2, w // 2, 2)
    if not np.isfinite(b).any():
        return np.full((h // 2, w // 2), np.nan, np.float32)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)          # squares that are all land/no-data stay NaN
        return np.nanmean(b, axis=(1, 3)).astype(np.float32)


# ------------------------------------------------------------------ reading surveys onto map squares

def tile_bounds_3857(z, x, y):
    s = EARTH / 2 ** z
    x0 = -EARTH / 2 + x * s
    y1 = EARTH / 2 - y * s
    return x0, y1 - s, x0 + s, y1


class Surveys:
    """The downloaded BlueTopo GeoTIFFs, read straight onto web-map squares (finest survey wins)."""

    def __init__(self, items: list[dict], folder: str, http, log=print):
        import rasterio
        self.items, self.ds = [], []
        for it in items:
            path = os.path.join(folder, re.sub(r"[^\w.-]", "_", it["tile"]) + ".tif")
            if not os.path.exists(path):
                with http.stream("GET", it["url"]) as r:
                    r.raise_for_status()
                    with open(path, "wb") as f:
                        for chunk in r.iter_bytes(1 << 20):
                            f.write(chunk)
            try:
                self.ds.append(rasterio.open(path)); self.items.append(it)
            except Exception as e:
                log(f"bottomhd: couldn't open {it['tile']} ({str(e)[:100]})")
        mb = sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder)) / 1e6
        log(f"bottomhd: {len(self.ds)} BlueTopo survey tiles ready ({mb:.0f} MB, {sorted({i['res_m'] for i in self.items})} m)")

    def square(self, z: int, x: int, y: int) -> np.ndarray:
        from rasterio.transform import from_bounds
        from rasterio.warp import Resampling, reproject
        from .tiles import tile_bounds
        w, s, e, n = tile_bounds(z, x, y)
        dst = np.full((SIZE, SIZE), np.nan, dtype=np.float32)
        tr = from_bounds(*tile_bounds_3857(z, x, y), SIZE, SIZE)
        for it, ds in zip(self.items, self.ds):
            b = it["bounds"]
            if b[2] < w or b[0] > e or b[3] < s or b[1] > n:
                continue
            tmp = np.full((SIZE, SIZE), np.nan, dtype=np.float32)
            reproject(source=__import__("rasterio").band(ds, 1), destination=tmp, src_transform=ds.transform, src_crs=ds.crs,
                      src_nodata=ds.nodata if ds.nodata is not None else np.nan, dst_transform=tr, dst_crs="EPSG:3857",
                      dst_nodata=np.nan, resampling=Resampling.bilinear)
            fill = np.isnan(dst) & np.isfinite(tmp)
            dst[fill] = tmp[fill]
            if np.isfinite(dst).all():
                break
        return dst


# ------------------------------------------------------------------ the job

def build_tree(read_square, put, z: int, x: int, y: int, bbox: tuple, stats: dict) -> np.ndarray:
    """Depth (m) for square (z, x, y), drawing it and every square under it down to MAX_Z."""
    from .tiles import tile_bounds
    w, s, e, n = tile_bounds(z, x, y)
    if e < bbox[0] or w > bbox[2] or n < bbox[1] or s > bbox[3]:
        return np.full((SIZE, SIZE), np.nan, dtype=np.float32)
    if z == MAX_Z:
        dem = read_square(z, x, y)
    else:
        q = [build_tree(read_square, put, z + 1, 2 * x + dx, 2 * y + dy, bbox, stats) for dy in (0, 1) for dx in (0, 1)]
        dem = half(np.block([[q[0], q[1]], [q[2], q[3]]]))
    img = draw(dem, z, (s + n) / 2)
    if img is not None:
        put(f"{z}/{x}/{y}.png", png(img)); stats["tiles"] += 1
    return dem


def run(store, area: str, http, log=print, budget_s: float = 48 * 60, force: bool = False):
    from .tiles import tiles_for_bbox
    t0 = time.time()
    bbox = AREAS[area]
    base = f"tiles/bottomhd/{area}/{HD_VERSION}"
    work_key = f"work/bottomhd/{area}/{HD_VERSION}/done.json"
    done = set() if force else set(json.loads(store.get(work_key) or b"[]"))
    key = latest_scheme_key(http)
    log(f"bottomhd: tile index {key.split('/')[-1]}")
    r = http.get(f"{BUCKET}/{key}"); r.raise_for_status()
    items = scheme_tiles(r.content, bbox)
    log(f"bottomhd: {len(items)} BlueTopo survey tiles cover the {area} area")
    if not items:
        raise RuntimeError("no BlueTopo coverage found for this area (if this keeps happening, NOAA may have changed the tile index format)")
    folder = tempfile.mkdtemp(prefix="bluetopo-")
    surveys = Surveys(items, folder, http, log)
    pool = ThreadPoolExecutor(max_workers=8)
    pending = []
    put = lambda k, data: pending.append(pool.submit(store.put, f"{base}/{k}", data, "image/png"))   # noqa: E731
    stats = {"tiles": 0}
    tops = list(tiles_for_bbox(bbox, TOP_Z))
    stopped = False
    for (z, x, y) in tops:
        k = f"{z}/{x}/{y}"
        if k in done:
            continue
        if time.time() - t0 > budget_s:
            stopped = True
            log("bottomhd: time's up for this run — saving progress (run again to continue)")
            break
        build_tree(surveys.square, put, z, x, y, bbox, stats)
        for f in pending:
            f.result()
        pending.clear()
        done.add(k)
        store.put(work_key, json.dumps(sorted(done)).encode(), "application/json")
        log(f"bottomhd: block {k} done — {stats['tiles']} map squares so far ({len(done)}/{len(tops)} blocks)")
    pool.shutdown(wait=True)
    complete = all(f"{z}/{x}/{y}" in done for (z, x, y) in tops)
    if not complete and store.get("manifests/bottomhd.json"):
        log(f"bottomhd: {len(done)}/{len(tops)} blocks drawn with the new lines — run `bottomhd` again to continue "
            "(the app keeps the old HD bottom until it's finished)")
        return
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")      # new address each build, so phones don't show old cached squares
    manifest = {"key": "bottomhd", "label": "HD bottom", "tiles": store.url(base) + "/{z}/{x}/{y}.png?v=" + stamp,
                "minzoom": TOP_Z, "maxzoom": MAX_Z, "areas": {area: list(bbox)}, "complete": complete, "style": HD_VERSION,
                "built_at": datetime.now(timezone.utc).isoformat(), "source": "NOAA BlueTopo (Office of Coast Survey)",
                "note": "Seafloor detail from NOAA surveys. For fishing, not navigation."}
    store.put("manifests/bottomhd.json", json.dumps(manifest).encode(), "application/json")
    log(f"bottomhd: saved — {len(done)}/{len(tops)} blocks, {stats['tiles']} map squares this run{'' if not stopped else ' (run again to continue)'}")


def restore(store, area: str, version: str, log=print) -> bool:
    """Point the app back at an earlier HD bottom build — nothing is redrawn. Every build since Oct 24 lives in its own
    folder: "legacy" = the build from before the smooth-line versions (tiles/bottomhd/<area>/), "v3", "v4" = the newer ones."""
    folders = {"legacy": (f"tiles/bottomhd/{area}", f"work/bottomhd/{area}/done.json")}
    for v in ("v3", "v4"):
        folders[v] = (f"tiles/bottomhd/{area}/{v}", f"work/bottomhd/{area}/{v}/done.json")
    for v, (_, wk) in folders.items():
        n = len(json.loads(store.get(wk) or b"[]"))
        log(f"bottomhd-restore: build '{v}': {n} blocks drawn" + ("  <- restoring this one" if v == version else ""))
    if version not in folders:
        log(f"bottomhd-restore: unknown version '{version}' — use legacy, v3 or v4"); return False
    base, wk = folders[version]
    if not json.loads(store.get(wk) or b"[]"):
        log(f"bottomhd-restore: build '{version}' has nothing saved, so nothing was changed"); return False
    bbox = AREAS[area]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    manifest = {"key": "bottomhd", "label": "HD bottom", "tiles": store.url(base) + "/{z}/{x}/{y}.png?v=" + stamp,
                "minzoom": TOP_Z, "maxzoom": MAX_Z, "areas": {area: list(bbox)}, "complete": True,
                "built_at": datetime.now(timezone.utc).isoformat(), "style": version, "restored": True,
                "source": "NOAA BlueTopo (Office of Coast Survey)", "note": "Seafloor detail from NOAA surveys. For fishing, not navigation."}
    store.put("manifests/bottomhd.json", json.dumps(manifest).encode(), "application/json")
    log(f"bottomhd-restore: the app now shows the '{version}' HD bottom (phones pick it up within a few minutes)")
    return True
