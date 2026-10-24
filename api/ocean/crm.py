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
# Backup: the same model (newer Version 2, 3 arc-second) straight from NOAA NCEI's own server, which is separate from
# the CoastWatch ERDDAP. Used when CoastWatch refuses or doesn't have it. NCSS = THREDDS "NetCDF Subset" service.
NCEI_NCSS = "https://www.ngdc.noaa.gov/thredds/ncss/crm/crm_socal_3as_vers2.nc"
NCEI_BOX = (-128.0, 30.0, -116.0, 37.0)
NCEI_ID = "ncei:crm_socal_3as_vers2"
# First choice (Oct 23): the plain file in NOAA NGDC's download folder — no data service in between, just a file on a
# web server. Downloaded once; the region is cut out of it and saved, so later runs don't download it again.
CRM_FILE_URL = "https://www.ngdc.noaa.gov/mgg/coastal/crm/thredds/crm_vol6.nc"
CRM_FILE_ID = "ngdc:crm_vol6.nc"
CRM_BOX = (-124.0, 32.0, -114.0, 37.0)
STEP = 1 / 1200.0                # 3 arc-seconds in degrees
BLOCK = 0.5
CONTOUR_TOP, CONTOUR_MAX = 9, 13
SIZE = 256
DENSITIES = ("std", "max")


def _read_nc(data: bytes, var_hint: str | None):
    """(lats, lons, values[lat, lon]) from a netCDF-3 or netCDF-4 file, whichever the server sent."""
    if data[:4] == b"\x89HDF":                       # netCDF-4 (HDF5 inside)
        return _read_nc4(data, var_hint)
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
    if tuple(getattr(v[name], "dimensions", ())) and v[name].dimensions[0] == lon:
        arr = arr.T                                   # stored [lon, lat] → [lat, lon]
    return np.array(v[lat].data, np.float64), np.array(v[lon].data, np.float64), arr


def _read_nc4(data: bytes, var_hint: str | None):
    import h5py
    f = h5py.File(io.BytesIO(data), "r")
    keys = list(f.keys())
    lat = next(k for k in keys if k.lower() in ("latitude", "lat", "y"))
    lon = next(k for k in keys if k.lower() in ("longitude", "lon", "x"))
    name = var_hint if var_hint in keys else next(k for k in keys if k not in (lat, lon) and getattr(f[k], "ndim", 0) == 2)
    d = f[name]
    arr = np.array(d[...], dtype=np.float32)
    fill = d.attrs.get("_FillValue")
    if fill is not None:
        arr[arr == np.float32(np.ravel(fill)[0])] = np.nan
    if arr.shape == (f[lon].shape[0], f[lat].shape[0]) and arr.shape[0] != arr.shape[1]:
        arr = arr.T
    return np.array(f[lat][...], np.float64), np.array(f[lon][...], np.float64), arr


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


class _Source:
    """One place to download the relief model from: a name, the box it covers, and get(lat0, lon0, lat1, lon1) → bytes
    (or, for a file already on disk, read_block(lat0, lon0, lat1, lon1) → (lats, lons, values[lat, lon]))."""
    def __init__(self, name: str, box: tuple, var: str, get=None, read_block=None):
        self.name, self.box, self.var, self.get, self.read_block = name, box, var, get, read_block


def _open_grid_file(path: str):
    """(lats ascending, lons, read(i0, i1, j0, j1) → values[lat, lon]) for a netCDF-3 or -4 grid on disk.
    Handles plain lat/lon grids (COARDS/CF) and the old GMT layout (x_range, y_range, spacing, dimension, flat z)."""
    with open(path, "rb") as fh:
        magic = fh.read(4)
    if magic == b"\x89HDF":
        import h5py
        f = h5py.File(path, "r")
        names = list(f.keys())
        var = lambda k: f[k]                                   # noqa: E731
        attrs = lambda k: dict(f[k].attrs)                     # noqa: E731
        dims_of = lambda k: tuple(d.label or "" for d in f[k].dims)   # noqa: E731
    else:
        from scipy.io import netcdf_file
        f = netcdf_file(path, "r", mmap=True)
        names = list(f.variables)
        var = lambda k: f.variables[k]                         # noqa: E731
        attrs = lambda k: dict(f.variables[k]._attributes)     # noqa: E731
        dims_of = lambda k: tuple(f.variables[k].dimensions)   # noqa: E731
    low = {n.lower(): n for n in names}
    ndim = lambda k: len(getattr(var(k), "shape", ()))   # noqa: E731  (works for scipy and h5py variables)

    def fill_of(k):
        a = attrs(k); v = a.get("_FillValue", a.get("missing_value"))
        return None if v is None else float(np.ravel(v)[0])

    if all(k in low for k in ("x_range", "y_range", "dimension", "z")) and ndim(low["z"]) == 1:
        nx, ny = (int(v) for v in np.array(var(low["dimension"])[:])[:2])
        xr = np.array(var(low["x_range"])[:], np.float64); yr = np.array(var(low["y_range"])[:], np.float64)
        pix = int(attrs(low["z"]).get("node_offset", 0)) == 1
        if pix:
            dxs, dys = (xr[1] - xr[0]) / nx, (yr[1] - yr[0]) / ny
            lons = xr[0] + (np.arange(nx) + 0.5) * dxs; lats = yr[0] + (np.arange(ny) + 0.5) * dys
        else:
            lons = np.linspace(xr[0], xr[1], nx); lats = np.linspace(yr[0], yr[1], ny)
        z = var(low["z"]); fill = fill_of(low["z"])

        def read(i0, i1, j0, j1):                               # GMT rows run north → south
            rows = [np.array(z[(ny - 1 - i) * nx + j0:(ny - 1 - i) * nx + j1], np.float32) for i in range(i0, i1)]
            arr = np.stack(rows) if rows else np.zeros((0, j1 - j0), np.float32)
            if fill is not None:
                arr[arr == np.float32(fill)] = np.nan
            return arr
        return lats, lons, read

    lat = next(low[k] for k in ("lat", "latitude", "y") if k in low)
    lon = next(low[k] for k in ("lon", "longitude", "x") if k in low)
    zname = next((low[k] for k in ("z", "band1", "elevation", "topo", "altitude") if k in low and ndim(low[k]) == 2), None) \
        or next(n for n in names if n not in (lat, lon) and ndim(n) == 2)
    z = var(zname); fill = fill_of(zname)
    lats = np.array(var(lat)[:], np.float64); lons = np.array(var(lon)[:], np.float64)
    lon_first = dims_of(zname)[:1] == (lon,) or (z.shape == (lons.size, lats.size) and lats.size != lons.size)
    desc = lats.size > 1 and lats[0] > lats[-1]
    ny = lats.size
    if desc:
        lats = lats[::-1]

    def read(i0, i1, j0, j1):
        r0, r1 = (ny - i1, ny - i0) if desc else (i0, i1)
        arr = np.array(z[j0:j1, r0:r1] if lon_first else z[r0:r1, j0:j1], np.float32)
        if lon_first:
            arr = arr.T
        if desc:
            arr = arr[::-1]
        if fill is not None:
            arr[arr == np.float32(fill)] = np.nan
        return arr
    return lats, lons, read


def _file_source(http, log, url: str = CRM_FILE_URL) -> _Source:
    """Download the whole relief-model file once (it's a few hundred MB), then cut blocks out of it on disk."""
    import os
    import tempfile
    path = os.path.join(tempfile.gettempdir(), os.path.basename(url))
    if not (os.path.exists(path) and os.path.getsize(path) > 1_000_000):
        log(f"crm: downloading {url}")
        with http.stream("GET", url) as r:
            if r.status_code != 200:
                raise RuntimeError(f"{CRM_FILE_ID} not available (HTTP {r.status_code})")
            got, next_log = 0, 50_000_000
            with open(path + ".part", "wb") as out:
                for chunk in r.iter_bytes(1 << 20):
                    out.write(chunk); got += len(chunk)
                    if got >= next_log:
                        log(f"crm: {got / 1e6:.0f} MB downloaded"); next_log += 50_000_000
        os.replace(path + ".part", path)
        log(f"crm: download done ({os.path.getsize(path) / 1e6:.0f} MB)")
    lats, lons_raw, read = _open_grid_file(path)
    lons = np.where(lons_raw > 180, lons_raw - 360.0, lons_raw)
    log(f"crm: {CRM_FILE_ID} grid {lats.size}×{lons.size}, {lats[0]:.2f}–{lats[-1]:.2f}°N, {lons.min():.2f}–{lons.max():.2f}°")

    def read_block(a, b, la1, lo1):
        e = STEP * 0.25                                   # grid points can sit a hair off the exact 3″ marks
        i0, i1 = int(np.searchsorted(lats, a - e)), int(np.searchsorted(lats, la1 - e))
        j0, j1 = int(np.searchsorted(lons, b - e)), int(np.searchsorted(lons, lo1 - e))
        if i1 <= i0 or j1 <= j0:
            return None
        return lats[i0:i1], lons[j0:j1], read(i0, i1, j0, j1)
    return _Source(CRM_FILE_ID, (float(lons.min()), float(lats[0]), float(lons.max()), float(lats[-1])), "z", read_block=read_block)


def _erddap_source(http, log) -> _Source:
    cid, dims, vars_ = pick_crm(http, log)
    off = lon_offset(cid)
    var = "topo" if "topo" in vars_ else vars_[0]
    lat_d = next((d for d in dims if "lat" in d.lower()), "latitude")
    log(f"crm: {cid} variable '{var}', dims {dims}{' (longitude 0–360)' if off else ''}")

    def get(a, b, la1, lo1):
        r = None
        for asc in (True, False):                      # some datasets store latitude north → south
            q = f"[({a:.5f}):1:({la1:.5f})]" if asc else f"[({la1:.5f}):1:({a:.5f})]"
            qlon = f"[({b + off:.5f}):1:({lo1 + off:.5f})]"
            q = q + qlon if dims.index(lat_d) == 0 else qlon + q
            for _ in range(3):
                r = http.get(f"{PFEG}/griddap/{cid}.nc?{var}{q}")
                if r.status_code == 200:
                    return r.content, 200
                if r.status_code in (400, 403, 404):
                    break
                time.sleep(5)
        return None, getattr(r, "status_code", 0)
    return _Source(cid, CRM_BOX, var, get)


def _ncei_source(http, log) -> _Source:
    """NCEI's THREDDS subset service. The elevation variable's name is read from the service's own description."""
    import re
    var = None
    try:
        r = http.get(f"{NCEI_NCSS}/dataset.xml")
        if r.status_code == 200:
            names = re.findall(r'<grid[^>]*\bname="([^"]+)"', r.text)
            var = next((n for n in names if n.lower() in ("z", "band1", "elevation", "topo", "altitude")), names[0] if names else None)
        else:
            log(f"crm: NCEI description not available (HTTP {r.status_code}); guessing the variable name")
    except Exception as e:  # noqa: BLE001
        log(f"crm: NCEI description failed ({str(e)[:80]}); guessing the variable name")
    guesses = [var] if var else ["z", "Band1", "elevation"]

    def get(a, b, la1, lo1):
        code = 0
        for v in list(guesses):
            for accept in ("netcdf3", "netcdf", "netcdf4"):
                params = {"var": v, "north": f"{la1:.5f}", "south": f"{a:.5f}", "west": f"{b:.5f}", "east": f"{lo1:.5f}",
                          "spatial": "bb", "horizStride": 1, "accept": accept, "addLatLon": "true"}
                for _ in range(3):
                    try:
                        r = http.get(NCEI_NCSS, params=params)
                    except Exception:  # noqa: BLE001  (timeouts: try again)
                        time.sleep(5); continue
                    code = r.status_code
                    if code == 200 and r.content[:3] in (b"CDF", b"\x89HD"):
                        if guesses[0] != v:                # remember the name that worked
                            guesses.remove(v); guesses.insert(0, v)
                        return r.content, 200
                    if code in (400, 403, 404, 415) or code == 200:
                        break
                    time.sleep(5)
        return None, code
    log(f"crm: using NOAA NCEI's copy (Coastal Relief Model Version 2), variable '{guesses[0]}'")
    return _Source(NCEI_ID, NCEI_BOX, guesses[0], get)


def _download(src: _Source, bbox, lats, lons, log) -> np.ndarray:
    lon0, lat0, lon1, lat1 = bbox
    out = np.full((lats.size, lons.size), np.nan, np.float32)
    clat0, clat1 = max(lat0, src.box[1]), min(lat1, src.box[3])
    clon0, clon1 = max(lon0, src.box[0]), min(lon1, src.box[2])
    blocks = [(a, b) for a in np.arange(clat0, clat1, BLOCK) for b in np.arange(clon0, clon1, BLOCK)]
    got = 0
    for k, (a, b) in enumerate(blocks):
        la1, lo1 = min(a + BLOCK, clat1), min(b + BLOCK, clon1)
        if src.read_block is not None:                    # a file already on disk
            blk = src.read_block(a, b, la1, lo1)
            if blk is None:
                continue
            blat, blon, arr = blk
            ii = np.clip(np.floor((blat - lat0) / STEP + 0.25).astype(int), 0, lats.size - 1)
            jj = np.clip(np.floor((blon - lon0) / STEP + 0.25).astype(int), 0, lons.size - 1)
            out[np.ix_(ii, jj)] = arr
            got += 1
            continue
        data, code = src.get(a, b, la1, lo1)
        if not data:
            log(f"crm: block {a:.2f},{b:.2f} not available from {src.name} (HTTP {code})")
            if got == 0 and k >= 2:                     # the first 3 blocks all failed: this source isn't working
                raise RuntimeError(f"{src.name} isn't sending data (HTTP {code})")
            continue
        blat, blon, arr = _read_nc(data, src.var)
        blon = np.where(blon > 180, blon - 360.0, blon)  # 0–360 datasets → the usual -180…180
        if arr.shape != (blat.size, blon.size):
            arr = arr.T
        ii = np.clip(np.floor((blat - lat0) / STEP + 0.25).astype(int), 0, lats.size - 1)
        jj = np.clip(np.floor((blon - lon0) / STEP + 0.25).astype(int), 0, lons.size - 1)
        out[np.ix_(ii, jj)] = arr
        got += 1
        if (k + 1) % 10 == 0:
            log(f"crm: {k + 1}/{len(blocks)} blocks downloaded from {src.name}")
    if got == 0:
        raise RuntimeError(f"{src.name} sent no data for this region")
    return out


def fetch_crm(bbox: tuple, http, log=print) -> Grid:
    """The relief model over bbox on a regular 3″ grid (meters, up positive); ETOPO fills what it doesn't cover.
    Tries NOAA CoastWatch's ERDDAP first, then NOAA NCEI's own server."""
    lon0, lat0, lon1, lat1 = bbox
    lats = lat0 + (np.arange(int(round((lat1 - lat0) / STEP))) + 0.5) * STEP
    lons = lon0 + (np.arange(int(round((lon1 - lon0) / STEP))) + 0.5) * STEP
    out, used, why = None, None, []
    for make in (_file_source, _erddap_source, _ncei_source):
        try:
            src = make(http, log)
            out = _download(src, bbox, lats, lons, log)
            used = src.name; break
        except Exception as e:  # noqa: BLE001
            why.append(str(e)[:160]); log(f"crm: {str(e)[:160]} — trying the next source")
    if out is None:
        raise RuntimeError("None of the three NOAA sources is sending the Southern California relief model right now "
                           f"({' | '.join(why)}). Nothing was changed; the current seafloor stays as it is. Try again later.")
    have = float(np.isfinite(out).mean())
    if have < 0.5:
        raise RuntimeError(f"Only {have:.0%} of the region came down from {used}. Nothing was changed; try again later.")
    log(f"crm: relief model ({used}) covers {have:.0%} of the region")
    if np.nanmedian(out) > 0:                         # the region is mostly ocean, so depths must come out negative
        out = -out; log("crm: depths came positive-down; flipped to the usual up-positive")
    if have < 1:
        try:
            g = fetch_grid(DATASETS["bathy"], bbox, None, http=http)
            miss = ~np.isfinite(out)
            ri, rj = np.nonzero(miss)
            out[miss] = g.sample(lats[ri], lons[rj]).astype(np.float32)
            log("crm: ETOPO filled the rest")
        except Exception as e:  # noqa: BLE001
            log(f"crm: ETOPO fill-in not available ({str(e)[:80]}); those few spots stay blank")
    return Grid(lats, lons, out, {"layer": "bathy", "units": "m", "source": f"NOAA Coastal Relief Model (3″, Southern California; {used}) + ETOPO",
                                  "dataset": used, "resolution_m": 90, "kind": "static"})


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
