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
    # Oct 29: all of Southern California — Point Conception to the Mexican border, out past the islands and banks.
    "socal": (-120.75, 32.45, -117.05, 34.55),
}
# (top zoom, deepest zoom) per area. The pilot is drawn to zoom 16; the whole region to zoom 14 (≈ 5 m per pixel,
# which already matches most NOAA surveys out there) — the map enlarges it smoothly when you zoom in further.
AREA_ZOOMS = {"pilot": (11, 16), "socal": (10, 14)}
CACHE_GB = 6.0               # survey files kept on the build machine between blocks
TOP_Z, MAX_Z = 11, 16
OVERVIEW_Z = 6               # Oct 30: zoomed-out squares down to this zoom, so HD bottom shows the moment it's switched on
HD_VERSION = "v6"            # Oct 30: deep-water triangles smoothed (hdrender DEEP_*). v5 = Oct 29: smooth seafloor, no survey "boxes" (see hdrender.py). v4 = Oct 24 lines
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


def draw_v4(dem_m: np.ndarray, z: int, lat: float) -> np.ndarray | None:
    """(Before Oct 29 — kept for the side-by-side preview.) RGBA (SIZE×SIZE) from elevation in meters (negative = under water, NaN = no data). None = nothing to draw."""
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


def draw(dem_m: np.ndarray, z: int, lat: float, res_m: np.ndarray | None = None, pad: int = 0, style: dict | None = None) -> np.ndarray | None:
    """v5 drawing (hdrender.py): RGBA 512×512. dem_m may be a 256 px square (it's smoothly enlarged) or a 512 px
    square with `pad` extra pixels read around it."""
    from scipy import ndimage
    from .hdrender import READ, draw as draw_v5
    if dem_m.shape[0] - 2 * pad != READ:
        k = READ / (dem_m.shape[0] - 2 * pad)
        ok = np.isfinite(dem_m)
        big = ndimage.zoom(np.where(ok, dem_m, 0.0), k, order=1)
        bok = ndimage.zoom(ok.astype(np.float32), k, order=1) > 0.5
        dem_m = np.where(bok, big, np.nan).astype(np.float32)
        res_m = None if res_m is None else ndimage.zoom(res_m, k, order=0)
        pad = int(round(pad * k))
    return draw_v5(dem_m, res_m, z, lat, pad, style=style)


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


def blend_surveys(layers: list, pxm: float, shape: tuple):
    """Surveys (finest first) → one depth grid + the cell size behind each pixel. Where a coarser survey takes over
    from a finer one, the two are feathered over a band of ~3 coarse cells instead of switching (no fake cliff)."""
    from scipy import ndimage
    acc = np.full(shape, np.nan, dtype=np.float32)
    res = np.full(shape, np.nan, dtype=np.float32)
    for tmp, r in layers:
        have, new = np.isfinite(acc), np.isfinite(tmp)
        if not have.any():
            acc, res = tmp.astype(np.float32), np.where(new, r, np.nan).astype(np.float32)
            continue
        seam = ~have & new                                       # where this coarser survey takes over
        if not seam.any():
            continue
        band = max(6.0, 3 * r / pxm)
        d = ndimage.distance_transform_edt(~seam)
        wf = np.clip(d / band, 0, 1).astype(np.float32)          # 0 at the seam → 1 deep inside the finer survey
        both = have & new
        acc = np.where(both, wf * acc + (1 - wf) * tmp, acc)
        res = np.where(both, wf * res + (1 - wf) * r, res)
        acc = np.where(seam, tmp, acc).astype(np.float32)
        res = np.where(seam, r, res).astype(np.float32)
        if np.isfinite(acc).all():
            break
    return acc, res


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

    def close(self):
        for ds in self.ds:
            try:
                ds.close()
            except Exception:
                pass

    def square(self, z: int, x: int, y: int, size: int | None = None, margin: int | None = None):
        """(depth m, survey cell size m) for map square z/x/y at `size` px plus `margin` px all round.
        Surveys are blended finest first; where a coarser survey takes over, the two are feathered together over a
        band of a few coarse cells instead of switching (no fake cliff along the seam). Land / no data = NaN."""
        from rasterio.transform import from_bounds
        from rasterio.warp import Resampling, reproject
        from .hdrender import MARGIN, READ
        from .tiles import tile_bounds
        size = READ if size is None else size
        margin = MARGIN if margin is None else margin
        full = size + 2 * margin
        x0, y0, x1, y1 = tile_bounds_3857(z, x, y)
        m = (x1 - x0) / size * margin
        tr = from_bounds(x0 - m, y0 - m, x1 + m, y1 + m, full, full)
        w, s, e, n = tile_bounds(z, x, y)
        dw = (e - w) * margin / size
        pxm = (x1 - x0) / size * math.cos(math.radians((s + n) / 2))
        layers, covered = [], np.zeros((full, full), bool)
        for it, ds in zip(self.items, self.ds):
            b = it["bounds"]
            if b[2] < w - dw or b[0] > e + dw or b[3] < s - dw or b[1] > n + dw:
                continue
            tmp = np.full((full, full), np.nan, dtype=np.float32)
            reproject(source=__import__("rasterio").band(ds, 1), destination=tmp, src_transform=ds.transform, src_crs=ds.crs,
                      src_nodata=ds.nodata if ds.nodata is not None else np.nan, dst_transform=tr, dst_crs="EPSG:3857",
                      dst_nodata=np.nan, resampling=Resampling.bilinear)
            if np.isfinite(tmp).any():
                layers.append((tmp, it["res_m"]))
                covered |= np.isfinite(tmp)
                if covered.all():
                    break
        return blend_surveys(layers, pxm, (full, full))


# ------------------------------------------------------------------ the job

def _norm_read(got):
    """read_square may give (depth, res) padded at READ + 2·MARGIN, or a plain depth square (tests)."""
    from scipy import ndimage
    from .hdrender import MARGIN, READ
    dem, res = got if isinstance(got, tuple) else (got, None)
    if res is None:
        res = np.full(dem.shape, 8.0, np.float32)
    if dem.shape[0] == READ + 2 * MARGIN:
        return dem, res, MARGIN
    k = READ / dem.shape[0]
    ok = np.isfinite(dem)
    big = ndimage.zoom(np.where(ok, dem, 0.0), k, order=1)
    bok = ndimage.zoom(ok.astype(np.float32), k, order=1) > 0.5
    return np.where(bok, big, np.nan).astype(np.float32), ndimage.zoom(res, k, order=0), 0


def half_res(a: np.ndarray) -> np.ndarray:
    h, w = a.shape
    b = a.reshape(h // 2, 2, w // 2, 2)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmax(b, axis=(1, 3)).astype(np.float32)


def build_tree(read_square, put, z: int, x: int, y: int, bbox: tuple, stats: dict, max_z: int = MAX_Z, style: dict | None = None):
    """(depth m, survey cell m) for square (z, x, y) at 512 px, drawing it and every square under it down to max_z."""
    from .hdrender import READ
    from .tiles import tile_bounds
    w, s, e, n = tile_bounds(z, x, y)
    if e < bbox[0] or w > bbox[2] or n < bbox[1] or s > bbox[3]:
        return np.full((READ, READ), np.nan, dtype=np.float32), np.full((READ, READ), np.nan, dtype=np.float32)
    if z == max_z:
        dem_p, res_p, pad = _norm_read(read_square(z, x, y))
        img = draw(dem_p, z, (s + n) / 2, res_p, pad, style=style)
        core = (slice(pad, pad + READ), slice(pad, pad + READ))
        dem, res = dem_p[core], res_p[core]
    else:
        q = [build_tree(read_square, put, z + 1, 2 * x + dx, 2 * y + dy, bbox, stats, max_z, style) for dy in (0, 1) for dx in (0, 1)]
        dem = half(np.block([[q[0][0], q[1][0]], [q[2][0], q[3][0]]]))
        res = half_res(np.block([[q[0][1], q[1][1]], [q[2][1], q[3][1]]]))
        img = draw(dem, z, (s + n) / 2, res, 0, style=style)
    if img is not None:
        put(f"{z}/{x}/{y}.png", png(img)); stats["tiles"] += 1
    return dem, res


def _shrink(imgs: list) -> np.ndarray:
    """Four 512 px RGBA squares (None = empty) → one 512 px square (alpha-weighted 2×2 average, so edges stay clean)."""
    n = 512
    big = np.zeros((2 * n, 2 * n, 4), np.float64)
    for i, im in enumerate(imgs):
        if im is not None:
            r, c = divmod(i, 2)
            big[r * n:(r + 1) * n, c * n:(c + 1) * n] = im
    a = big[..., 3:4] / 255.0
    pre = (big[..., :3] * a).reshape(n, 2, n, 2, 3).sum(axis=(1, 3))
    asum = a.reshape(n, 2, n, 2, 1).sum(axis=(1, 3))
    out = np.zeros((n, n, 4), np.uint8)
    out[..., :3] = np.clip(np.where(asum > 0, pre / np.maximum(asum, 1e-9), 0), 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(asum[..., 0] / 4 * 255, 0, 255).astype(np.uint8)
    return out


def overview(store, base: str, bbox: tuple, top_z: int, low_z: int = OVERVIEW_Z, log=print) -> int:
    """Zoomed-out squares (top_z-1 … low_z) made by shrinking the squares already drawn, so HD bottom shows right away
    when it's switched on instead of only after zooming in. Cheap (a few hundred squares); redone after every run."""
    from PIL import Image
    from .tiles import tiles_for_bbox

    def load(z, x, y, made):
        if (z, x, y) in made:
            return made[(z, x, y)]
        b = store.get(f"{base}/{z}/{x}/{y}.png")
        return None if not b else np.asarray(Image.open(io.BytesIO(b)).convert("RGBA").resize((512, 512)))

    n = 0
    made: dict = {}
    for z in range(top_z - 1, low_z - 1, -1):
        for (_, x, y) in tiles_for_bbox(bbox, z):
            kids = [load(z + 1, 2 * x + dx, 2 * y + dy, made) for dy in (0, 1) for dx in (0, 1)]
            if all(k is None for k in kids):
                continue
            img = _shrink(kids)
            if not img[..., 3].any():
                continue
            made[(z, x, y)] = img
            store.put(f"{base}/{z}/{x}/{y}.png", png(img), "image/png"); n += 1
    log(f"bottomhd: {n} zoomed-out squares made (zoom {low_z}–{top_z - 1})")
    return n


API_URL = os.environ.get("API_URL", "https://fishing-app-api-pzto.onrender.com")


def published_style(http, log=print) -> dict:
    """The HD bottom look saved from Map Studio (Send to app → app_config "hd_style"), read through the app's API.
    Nothing saved / API asleep → {} = the built-in look."""
    if not API_URL or os.environ.get("STORAGE") == "local":
        return {}
    for attempt in range(3):
        try:
            r = http.get(f"{API_URL}/config/hd_style", timeout=90)
            if r.status_code == 200:
                v = r.json().get("value") or {}
                st = v.get("style") if isinstance(v, dict) and "style" in v else v
                return st if isinstance(st, dict) else {}
            if r.status_code == 404:
                return {}
        except Exception as e:
            log(f"bottomhd: couldn't read the Map Studio style ({type(e).__name__}) — try {attempt + 1}/3")
        time.sleep(5)
    log("bottomhd: using the built-in look")
    return {}


def style_tag(style: dict) -> str:
    """'' for the built-in look; otherwise a short code, so each look gets its own folder (no mixing of looks)."""
    import hashlib
    from .hdrender import default_style, resolve
    st = resolve(style)
    if st == default_style():
        return ""
    return "-s" + hashlib.sha1(json.dumps(st, sort_keys=True).encode()).hexdigest()[:6]


def manifest_name(area: str) -> tuple[str, str]:
    """(store key, catalog key): the pilot keeps the original names; other areas get their own."""
    return ("manifests/bottomhd.json", "bottomhd") if area == "pilot" else (f"manifests/bottomhd-{area}.json", f"bottomhd_{area}")


def _trim_cache(folder: str, keep: set, log=print) -> None:
    """Keep the build machine's disk from filling up: drop survey files the current block doesn't need (oldest first)."""
    files = [os.path.join(folder, f) for f in os.listdir(folder)]
    total = sum(os.path.getsize(f) for f in files) / 1e9
    if total <= CACHE_GB:
        return
    for f in sorted(files, key=os.path.getmtime):
        if os.path.basename(f) in keep:
            continue
        total -= os.path.getsize(f) / 1e9
        os.unlink(f)
        if total <= CACHE_GB * 0.5:
            break
    log(f"bottomhd: survey cache trimmed to {total:.1f} GB")


def run(store, area: str, http, log=print, budget_s: float = 48 * 60, force: bool = False):
    from .tiles import tile_bounds, tiles_for_bbox
    t0 = time.time()
    if os.path.exists("bottomhd-continue.txt"):
        os.unlink("bottomhd-continue.txt")
    bbox = AREAS[area]
    top_z, max_z = AREA_ZOOMS.get(area, (TOP_Z, MAX_Z))
    mkey, ckey = manifest_name(area)
    style = published_style(http, log)
    tag = style_tag(style)
    if tag:
        log(f"bottomhd: drawing with the look saved from Map Studio ({tag[2:]})")
    base = f"tiles/bottomhd/{area}/{HD_VERSION}{tag}"
    work_key = f"work/bottomhd/{area}/{HD_VERSION}{tag}/done.json"
    done = set() if force else set(json.loads(store.get(work_key) or b"[]"))
    key = latest_scheme_key(http)
    log(f"bottomhd: tile index {key.split('/')[-1]}")
    r = http.get(f"{BUCKET}/{key}"); r.raise_for_status()
    items = scheme_tiles(r.content, bbox)
    log(f"bottomhd: {len(items)} BlueTopo survey tiles cover the {area} area (zoom {top_z}–{max_z})")
    if not items:
        raise RuntimeError("no BlueTopo coverage found for this area (if this keeps happening, NOAA may have changed the tile index format)")
    folder = tempfile.mkdtemp(prefix="bluetopo-")
    pool = ThreadPoolExecutor(max_workers=8)
    pending = []
    put = lambda k, data: pending.append(pool.submit(store.put, f"{base}/{k}", data, "image/png"))   # noqa: E731
    stats = {"tiles": 0}
    tops = list(tiles_for_bbox(bbox, top_z))
    stopped = False
    for (z, x, y) in tops:
        k = f"{z}/{x}/{y}"
        if k in done:
            continue
        if time.time() - t0 > budget_s:
            stopped = True
            log("bottomhd: time's up for this run — saving progress (it continues in the next run)")
            break
        # only the surveys that touch this block (with a small margin), downloaded as needed
        w, s_, e, n = tile_bounds(z, x, y)
        mg = (e - w) * 0.05
        here = [it for it in items if not (it["bounds"][2] < w - mg or it["bounds"][0] > e + mg or it["bounds"][3] < s_ - mg or it["bounds"][1] > n + mg)]
        if here:
            _trim_cache(folder, {re.sub(r"[^\w.-]", "_", it["tile"]) + ".tif" for it in here}, log)
            surveys = Surveys(here, folder, http, log)
            build_tree(surveys.square, put, z, x, y, bbox, stats, max_z, style)
            surveys.close()
        for f in pending:
            f.result()
        pending.clear()
        done.add(k)
        store.put(work_key, json.dumps(sorted(done)).encode(), "application/json")
        log(f"bottomhd: block {k} done — {stats['tiles']} map squares so far ({len(done)}/{len(tops)} blocks)")
    pool.shutdown(wait=True)
    complete = all(f"{z}/{x}/{y}" in done for (z, x, y) in tops)
    if not complete:
        with open("bottomhd-continue.txt", "w") as fh:          # the workflow sees this and starts the next run itself
            fh.write(area)
    if not complete and store.get(mkey):
        log(f"bottomhd: {len(done)}/{len(tops)} blocks drawn with the new style — continuing in the next run "
            "(the app keeps the old HD bottom until it's finished)")
        return
    overview(store, base, bbox, top_z, log=log)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")      # new address each build, so phones don't show old cached squares
    manifest = {"key": ckey, "label": "HD bottom", "tiles": store.url(base) + "/{z}/{x}/{y}.png?v=" + stamp,
                "minzoom": min(top_z, OVERVIEW_Z), "maxzoom": max_z, "areas": {area: list(bbox)}, "complete": complete, "style": HD_VERSION + tag,
                "progress": f"{len(done)}/{len(tops)}",
                "built_at": datetime.now(timezone.utc).isoformat(), "source": "NOAA BlueTopo (Office of Coast Survey)",
                "note": "Seafloor detail from NOAA surveys. For fishing, not navigation."}
    store.put(mkey, json.dumps(manifest).encode(), "application/json")
    log(f"bottomhd: saved — {len(done)}/{len(tops)} blocks, {stats['tiles']} map squares this run{'' if complete else ' (continuing in the next run)'}")


def restore(store, area: str, version: str, log=print) -> bool:
    """Point the app back at an earlier HD bottom build — nothing is redrawn. Every build since Oct 24 lives in its own
    folder: "legacy" = the build from before the smooth-line versions (tiles/bottomhd/<area>/), "v3", "v4" = the newer ones."""
    folders = {"legacy": (f"tiles/bottomhd/{area}", f"work/bottomhd/{area}/done.json")}
    for v in ("v3", "v4", "v5", "v6"):
        folders[v] = (f"tiles/bottomhd/{area}/{v}", f"work/bottomhd/{area}/{v}/done.json")
    for v, (_, wk) in folders.items():
        n = len(json.loads(store.get(wk) or b"[]"))
        log(f"bottomhd-restore: build '{v}': {n} blocks drawn" + ("  <- restoring this one" if v == version else ""))
    if version not in folders:
        log(f"bottomhd-restore: unknown version '{version}' — use legacy, v3, v4, v5 or v6"); return False
    base, wk = folders[version]
    if not json.loads(store.get(wk) or b"[]"):
        log(f"bottomhd-restore: build '{version}' has nothing saved, so nothing was changed"); return False
    bbox = AREAS[area]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    top_z, max_z = AREA_ZOOMS.get(area, (TOP_Z, MAX_Z))
    mkey, ckey = manifest_name(area)
    manifest = {"key": ckey, "label": "HD bottom", "tiles": store.url(base) + "/{z}/{x}/{y}.png?v=" + stamp,
                "minzoom": top_z, "maxzoom": max_z, "areas": {area: list(bbox)}, "complete": True,
                "built_at": datetime.now(timezone.utc).isoformat(), "style": version, "restored": True,
                "source": "NOAA BlueTopo (Office of Coast Survey)", "note": "Seafloor detail from NOAA surveys. For fishing, not navigation."}
    store.put(mkey, json.dumps(manifest).encode(), "application/json")
    log(f"bottomhd-restore: the app now shows the '{version}' HD bottom (phones pick it up within a few minutes)")
    return True


# ------------------------------------------------------------------ preview (check it before it ships)

PREVIEW_SPOTS = [
    ("LA Harbor · Angels Gate", 33.7105, -118.2470),
    ("Long Beach breakwater", 33.7230, -118.1700),
    ("Palos Verdes · Point Vicente", 33.7410, -118.4130),
    ("Catalina · Ship Rock / Isthmus", 33.4630, -118.4920),
    ("Catalina · Avalon", 33.3480, -118.3220),
    ("San Pedro Channel · deep slope", 33.6300, -118.3000),
    ("Catalina · east-end drop-off", 33.3200, -118.2800),
]


def draw_v5(dem_m, z, lat, res_m, pad):
    """The Oct 29 (v5) drawing, for the preview's "NOW" column: no deep-water smoothing, no pinhole filling."""
    from . import hdrender as H
    keep = (H.DEEP_COLOR, H.DEEP_SHADE, H.DEEP_LINE, H.FILL_HOLES)
    H.DEEP_COLOR = H.DEEP_SHADE = H.DEEP_LINE = 0.0; H.FILL_HOLES = False
    try:
        return draw(dem_m, z, lat, res_m, pad)
    finally:
        H.DEEP_COLOR, H.DEEP_SHADE, H.DEEP_LINE, H.FILL_HOLES = keep


def preview_sheet(rows: list[dict], title: str) -> bytes:
    """One picture: for each spot, NOW vs NEW at zoom 14 and zoomed right in (zoom 16 shown at 2× like zoom 17)."""
    from PIL import Image, ImageDraw, ImageFont
    cell, gap, head = 380, 12, 64
    try:
        f = ImageFont.truetype("DejaVuSans-Bold.ttf", 20); fs = ImageFont.truetype("DejaVuSans.ttf", 16)
    except OSError:
        f = fs = ImageFont.load_default()
    cols = ["NOW · zoom 14", "NEW · zoom 14", "NOW · zoomed in (17)", "NEW · zoomed in (17)"]
    W = gap + 4 * (cell + gap)
    H = 70 + len(rows) * (cell + head + gap)
    sheet = Image.new("RGB", (W, H), (236, 240, 244)); d = ImageDraw.Draw(sheet)
    d.text((gap, 18), title, fill=(10, 30, 50), font=f)
    y = 70
    for r in rows:
        d.text((gap, y + 6), f"{r['name']}  —  NOAA survey cells here: {r['res']}", fill=(10, 30, 50), font=f)
        for i, (lab, im) in enumerate(zip(cols, r["imgs"])):
            x = gap + i * (cell + gap)
            d.text((x, y + 36), lab, fill=(70, 80, 90), font=fs)
            tile = Image.new("RGB", (cell, cell), (245, 236, 200))                       # land color behind
            if im is not None:
                pic = Image.fromarray(im, "RGBA")
                if i >= 2:                                                                # zoomed: middle quarter at 2×
                    w = pic.width
                    pic = pic.crop((w // 4, w // 4, 3 * w // 4, 3 * w // 4))
                pic = pic.resize((cell, cell), Image.BICUBIC)
                tile.paste(pic, (0, 0), pic)
            sheet.paste(tile, (x, y + head))
        y += cell + head + gap
    import io as _io
    buf = _io.BytesIO(); sheet.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def preview(store, area: str, http, log=print, out_path: str | None = None) -> str:
    """`python -m ocean.jobs bottomhd-preview`: draws a few real spots the old way and the new way from NOAA's real
    surveys, saves one comparison picture to the data bucket (link printed in the log) and to bottomhd-preview.png
    (downloadable from the GitHub run page, under Artifacts). Nothing in the app changes."""
    from .tiles import lonlat_to_tile
    key = latest_scheme_key(http)
    r = http.get(f"{BUCKET}/{key}"); r.raise_for_status()
    near = 0.02
    rows = []
    folder = tempfile.mkdtemp(prefix="bluetopo-prev-")
    for name, lat, lon in PREVIEW_SPOTS:
        items = scheme_tiles(r.content, (lon - near, lat - near, lon + near, lat + near))
        if not items:
            log(f"bottomhd-preview: no NOAA survey at {name}"); continue
        sv = Surveys(items, folder, http, log)
        imgs = []
        for z, zoomed in ((14, False), (16, True)):
            x, y = lonlat_to_tile(lon, lat, z)
            dem, res = sv.square(z, x, y)
            from .hdrender import MARGIN
            imgs.append((draw_v5(dem, z, lat, res, MARGIN), draw(dem, z, lat, res, MARGIN), res))
        cells = [v for v in np.unique(np.round(imgs[1][2][np.isfinite(imgs[1][2])])) if v > 0]
        rows.append({"name": name, "res": ", ".join(f"{int(c)} m" for c in cells) or "—",
                     "imgs": [imgs[0][0], imgs[0][1], imgs[1][0], imgs[1][1]]})
        log(f"bottomhd-preview: {name} drawn (survey cells {rows[-1]['res']})")
    data = preview_sheet(rows, f"HD bottom — now (v5) vs new ({HD_VERSION}) · {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC · from NOAA BlueTopo")
    k = f"previews/bottomhd-{HD_VERSION}-{datetime.now(timezone.utc):%Y%m%d%H%M}.png"
    store.put(k, data, "image/png")
    if out_path:
        with open(out_path, "wb") as fh:
            fh.write(data)
    log(f"bottomhd-preview: picture saved → {store.url(k)}")
    return store.url(k)


def overview_only(store, area: str, log=print) -> bool:
    """Just (re)make the zoomed-out squares for the build the app shows now, and tell the app (no survey downloads)."""
    mkey, _ = manifest_name(area)
    raw = store.get(mkey)
    if not raw:
        log(f"bottomhd-overview: no HD bottom for '{area}' yet"); return False
    m = json.loads(raw)
    top_z, _ = AREA_ZOOMS.get(area, (TOP_Z, MAX_Z))
    tiles = m["tiles"].split("?")[0]
    base = tiles[len(store.url("")):].rsplit("/{z}", 1)[0] if tiles.startswith(store.url("")) else None
    if not base:
        log("bottomhd-overview: can't tell where the squares are kept"); return False
    overview(store, base, AREAS[area], top_z, log=log)
    m["minzoom"] = min(top_z, OVERVIEW_Z)
    m["tiles"] = tiles + "?v=" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    store.put(mkey, json.dumps(m).encode(), "application/json")
    log(f"bottomhd-overview: done — the app shows '{area}' HD bottom from zoom {m['minzoom']}")
    return True
