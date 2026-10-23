"""python -m ocean.jobs crm  — sharper seafloor for the whole region from NOAA's Southern California Coastal Relief
Model (3 arc-second, ~90 m; vs. the ~1.8 km global grid used before). What it updates:
  • "Relief & structure" tiles, now to zoom 12, and the depth you get when you tap the map;
  • the vector "Depth contours" (from a ~700 m copy, as before but from much better data);
  • two NEW raster contour layers for the "Contour detail" choice: Standard and Max (lots of lines: every 10 ft
    near shore when zoomed in), with depth labels on the bold lines. Drawn zoom 9–13; the map stretches them past 13.
Where the model has no data (south of 32°N, Mexico) the old global grid fills in.
Resumable: the downloaded model is saved to storage, and contour squares are saved per ~80 km block.
"""
from __future__ import annotations

import io
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .erddap import describe, fetch_grid, list_datasets
from .grid import Grid
from .registry import DATASETS, PFEG, REGIONS

# Topography, NOAA Coastal Relief Model, 3 arc second, Vol. 6 (Southern California).
# NOAA retired the plain "usgsCeCrm6" name in 2026; the same data now lives under "usgsCeCrm6_Lon0360", which writes
# longitude as 0–360 (so -118° is 242°). Newest name first; if both vanish we search NOAA's catalog by title.
CRM_IDS = ("usgsCeCrm6_Lon0360", "usgsCeCrm6")
CRM_ID = CRM_IDS[0]
CRM_TITLE = ".*Coastal Relief Model.*Southern California.*"
CRM_BOX = (-124.0, 32.0, -114.0, 37.0)
STEP = 1 / 1200.0                # 3 arc-seconds in degrees
BLOCK = 0.5
CONTOUR_TOP, CONTOUR_MAX = 9, 13
SIZE = 256
DENSITIES = ("std", "max")


def _read_nc(data: bytes, var_hint: str | None):
    from scipy.io import netcdf_file
    f = netcdf_file(io.BytesIO(data), mmap=False)
    v = f.variables
    lat = next(k for k in v if k.lower() in ("latitude", "lat", "y"))
    lon = next(k for k in v if k.lower() in ("longitude", "lon", "x"))
    name = var_hint if var_hint in v else next(k for k in v if k not in (lat, lon) and len(v[k].shape) == 2)
    arr = np.array(v[name].data, dtype=np.float32)
    fill = getattr(v[name], "_FillValue", None)
    if fill is not None:
        arr[arr == np.float32(fill)] = np.nan
    return np.array(v[lat].data, np.float64), np.array(v[lon].data, np.float64), arr


def lon_offset(dataset_id: str) -> float:
    """360 for datasets that write longitude as 0–360 (ERDDAP names them …_Lon0360), else 0."""
    return 360.0 if "lon0360" in dataset_id.lower() else 0.0


def pick_crm(http, log=print) -> tuple[str, list, list]:
    """The first relief-model dataset NOAA still answers for: (dataset id, dims, variables)."""
    tried = []
    for cid in CRM_IDS:
        try:
            dims, vars_ = describe(PFEG, cid, http)
            return cid, dims, vars_
        except Exception as e:  # noqa: BLE001  (404 = renamed/retired; try the next name)
            tried.append(cid); log(f"crm: {cid} not available ({str(e)[:80]})")
    try:
        found = [d["id"] for d in list_datasets(PFEG, CRM_TITLE, http) if d["id"] not in tried]
    except Exception as e:  # noqa: BLE001
        found = []; log(f"crm: couldn't search NOAA's catalog ({str(e)[:80]})")
    found.sort(key=lambda i: (lon_offset(i) == 0, i))    # same order as CRM_IDS: 0–360 copies first
    for cid in found:
        try:
            dims, vars_ = describe(PFEG, cid, http)
            log(f"crm: found the relief model under a new name: {cid}")
            return cid, dims, vars_
        except Exception:  # noqa: BLE001
            tried.append(cid)
    raise RuntimeError(f"NOAA's Southern California relief model isn't answering under any known name ({', '.join(tried)}). "
                       "Nothing was changed; the current seafloor stays as it is.")


def fetch_crm(bbox: tuple, http, log=print) -> Grid:
    """The relief model over bbox on a regular 3″ grid (meters, up positive); ETOPO fills what it doesn't cover."""
    cid, dims, vars_ = pick_crm(http, log)
    off = lon_offset(cid)
    var = "topo" if "topo" in vars_ else vars_[0]
    lat_d = next((d for d in dims if "lat" in d.lower()), "latitude")
    log(f"crm: {cid} variable '{var}', dims {dims}{' (longitude 0–360)' if off else ''}")
    lon0, lat0, lon1, lat1 = bbox
    lats = lat0 + (np.arange(int(round((lat1 - lat0) / STEP))) + 0.5) * STEP
    lons = lon0 + (np.arange(int(round((lon1 - lon0) / STEP))) + 0.5) * STEP
    out = np.full((lats.size, lons.size), np.nan, np.float32)
    clat0, clat1 = max(lat0, CRM_BOX[1]), min(lat1, CRM_BOX[3])
    clon0, clon1 = max(lon0, CRM_BOX[0]), min(lon1, CRM_BOX[2])
    blocks = [(a, b) for a in np.arange(clat0, clat1, BLOCK) for b in np.arange(clon0, clon1, BLOCK)]
    for k, (a, b) in enumerate(blocks):
        la1, lo1 = min(a + BLOCK, clat1), min(b + BLOCK, clon1)
        data = None
        for asc in (True, False):                      # some datasets store latitude north → south
            q = f"[({a:.5f}):1:({la1:.5f})]" if asc else f"[({la1:.5f}):1:({a:.5f})]"
            qlon = f"[({b + off:.5f}):1:({lo1 + off:.5f})]"
            q = q + qlon if dims.index(lat_d) == 0 else qlon + q
            for attempt in range(3):
                r = http.get(f"{PFEG}/griddap/{cid}.nc?{var}{q}")
                if r.status_code == 200:
                    data = r.content; break
                if r.status_code in (400, 404):
                    break
                time.sleep(5)
            if data:
                break
        if not data:
            log(f"crm: block {a:.2f},{b:.2f} not available (HTTP {r.status_code}) — ETOPO will fill it")
            continue
        blat, blon, arr = _read_nc(data, var)
        blon = np.where(blon > 180, blon - 360.0, blon)  # 0–360 datasets → the usual -180…180
        if dims.index(lat_d) != 0:
            arr = arr.T
        ii = np.clip(np.rint((blat - lat0) / STEP - 0.5).astype(int), 0, lats.size - 1)
        jj = np.clip(np.rint((blon - lon0) / STEP - 0.5).astype(int), 0, lons.size - 1)
        out[np.ix_(ii, jj)] = arr
        if (k + 1) % 10 == 0:
            log(f"crm: {k + 1}/{len(blocks)} blocks downloaded")
    have = float(np.isfinite(out).mean())
    log(f"crm: relief model covers {have:.0%} of the region; ETOPO fills the rest")
    if have < 1:
        g = fetch_grid(DATASETS["bathy"], bbox, None, http=http)
        miss = ~np.isfinite(out)
        ri, rj = np.nonzero(miss)
        out[miss] = g.sample(lats[ri], lons[rj]).astype(np.float32)
    return Grid(lats, lons, out, {"layer": "bathy", "units": "m", "source": "NOAA Coastal Relief Model (3″, Southern California) + ETOPO",
                                  "dataset": cid, "resolution_m": 90, "kind": "static"})


def to_npz(g: Grid) -> bytes:
    buf = io.BytesIO()
    np.savez_compressed(buf, lats=g.lats, lons=g.lons, values=g.values.astype(np.float16))
    return buf.getvalue()


def from_npz(raw: bytes) -> Grid:
    z = np.load(io.BytesIO(raw))
    return Grid(z["lats"], z["lons"], z["values"].astype(np.float32),
                {"layer": "bathy", "units": "m", "source": "NOAA Coastal Relief Model (3″, Southern California) + ETOPO", "dataset": CRM_ID, "resolution_m": 90, "kind": "static"})


def square_depth_ft(g: Grid, z: int, x: int, y: int) -> np.ndarray:
    """Depth (ft, positive down; NaN on land) for one map square, smoothly interpolated from the model."""
    from scipy.ndimage import map_coordinates
    from .tiles import pixel_lonlat
    lon, lat = pixel_lonlat(z, x, y)
    fi = (lat - g.lats[0]) / (g.lats[1] - g.lats[0])
    fj = (lon - g.lons[0]) / (g.lons[1] - g.lons[0])
    v = map_coordinates(g.values, [fi, fj], order=1, mode="nearest", prefilter=False)
    outside = (fi < 0) | (fi > g.lats.size - 1) | (fj < 0) | (fj > g.lons.size - 1)
    return np.where((v < 0) & ~outside, -v * 3.28084, np.nan).astype(np.float32)


def contour_tree(g: Grid, put, z: int, x: int, y: int, bbox: tuple, stats: dict) -> np.ndarray:
    """Depth for square (z, x, y), drawing it (both densities) and every square under it down to CONTOUR_MAX."""
    from .contourtiles import lines_only
    from .bottomhd import half
    from .tiles import tile_bounds
    from .contourtiles import levels  # noqa: F401  (keeps the import cost out of the loop)
    w, s, e, n = tile_bounds(z, x, y)
    if e < bbox[0] or w > bbox[2] or n < bbox[1] or s > bbox[3]:
        return np.full((SIZE, SIZE), np.nan, np.float32)
    if z == CONTOUR_MAX:
        d = square_depth_ft(g, z, x, y)
    else:
        q = [contour_tree(g, put, z + 1, 2 * x + dx, 2 * y + dy, bbox, stats) for dy in (0, 1) for dx in (0, 1)]
        d = half(np.block([[q[0], q[1]], [q[2], q[3]]]))
    for dens in DENSITIES:
        img = lines_only(d, z, dens)
        if img is not None:
            from .bottomhd import png
            put(f"{dens}/{z}/{x}/{y}.png", png(img)); stats["tiles"] += 1
    return d


def run(store, region: str, http, log=print, budget_s: float = 48 * 60, force: bool = False):
    from .jobs import run_bathy
    from .tiles import tiles_for_bbox
    t0 = time.time()
    bbox = REGIONS[region]
    cache = f"work/crm/{region}.npz"
    raw = None if force else store.get(cache)
    if raw:
        g = from_npz(raw); log(f"crm: using the saved relief model ({g.values.shape[1]}×{g.values.shape[0]})")
    else:
        g = fetch_crm(bbox, http, log)
        store.put(cache, to_npz(g), "application/octet-stream")
    base = f"tiles/contours/{region}"
    extra = {"contour_tiles": {d: store.url(f"{base}/{d}") + "/{z}/{x}/{y}.png" for d in DENSITIES},
             "contour_zooms": [CONTOUR_TOP, CONTOUR_MAX], "relief_model": g.meta.get("dataset", CRM_ID)}
    work_key = f"work/crm/{region}/done.json"
    done = set() if force else set(json.loads(store.get(work_key) or b"[]"))
    if "relief" not in done:
        run_bathy(region, None, grid=g, extra=extra, zooms=range(5, 13))
        done.add("relief"); store.put(work_key, json.dumps(sorted(done)).encode(), "application/json")
        log("crm: relief tiles, depth lookup and vector contours updated")
    pool = ThreadPoolExecutor(max_workers=8)
    pending, stats = [], {"tiles": 0}
    put = lambda k, data: pending.append(pool.submit(store.put, f"{base}/{k}", data, "image/png"))   # noqa: E731
    tops = list(tiles_for_bbox(bbox, CONTOUR_TOP))
    stopped = False
    for (z, x, y) in tops:
        k = f"{z}/{x}/{y}"
        if k in done:
            continue
        if time.time() - t0 > budget_s:
            stopped = True; log("crm: time's up for this run — saving progress (run again to continue)"); break
        contour_tree(g, put, z, x, y, bbox, stats)
        for f in pending:
            f.result()
        pending.clear()
        done.add(k); store.put(work_key, json.dumps(sorted(done)).encode(), "application/json")
        log(f"crm: contour block {k} done — {stats['tiles']} squares this run ({len([d for d in done if '/' in d])}/{len(tops)} blocks)")
    pool.shutdown(wait=True)
    # make sure the manifest carries the contour tiles (also when the relief step ran in an earlier run)
    m = json.loads(store.get("manifests/bathy.json") or b"{}")
    if m.get("dates"):
        m["dates"][0].update(extra); m["dates"][0]["contours_complete"] = not stopped
        store.put("manifests/bathy.json", json.dumps(m).encode(), "application/json")
    log(f"crm: saved — {len([d for d in done if '/' in d])}/{len(tops)} contour blocks{' (run again to continue)' if stopped else ''}")
