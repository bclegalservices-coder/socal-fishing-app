"""Daily ocean-data job. Run from the `api` folder:

    python -m ocean.jobs discover            # list current SST / chlorophyll datasets on ERDDAP
    python -m ocean.jobs verify              # check every configured dataset answers
    python -m ocean.jobs sst --days 0,1,2,3,7
    python -m ocean.jobs chl --days 0,1,2,3,7
    python -m ocean.jobs bathy               # once (or when a better seafloor file is added)
    python -m ocean.jobs all

Output (local ./data or Cloudflare R2): tiles/, vectors/, grids/, manifests/.
"""
import argparse
import io
import json
import sys
from datetime import date, datetime, timedelta, timezone

import httpx
import numpy as np
from PIL import Image

from core.storage import get_store
from . import bathy as bathy_mod
from .breaks import break_lines
from .colormaps import CHL, DEPTH_FT, SST_F, apply, legend
from .erddap import fetch_grid, search
from .grid import Grid, to_display_units
from .registry import BREAKS, DATASETS, REGIONS, TILE_ZOOMS
from .tiles import pixel_lonlat, render, tiles_for_bbox

KEEP_DAYS = 14
LEGENDS = {
    "sst": legend(SST_F, "°F", [54, 58, 62, 66, 70, 74, 78]),
    "chl": legend(CHL, "mg/m³", [0.05, 0.1, 0.25, 0.5, 1, 3, 10]),
    "bathy": legend(DEPTH_FT, "ft", [60, 300, 600, 1200, 3000, 6000]),
}
LABELS = {
    "sst": "Sea surface temperature", "chl": "Chlorophyll (water color)", "bathy": "Seafloor relief & structure",
}
NOTES = {
    "sst": "Satellite blend that fills cloud gaps (interpolated). Check the date; it is not live.",
    "chl": "Satellite observation. Blank areas are clouds or fog, not clean water.",
    "bathy": "Seafloor information for fishing. Not a navigation chart.",
}


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def _manifest(store, layer: str) -> dict:
    raw = store.get(f"manifests/{layer}.json")
    return json.loads(raw) if raw else {"layer": layer, "dates": []}


def _save_manifest(store, layer: str, m: dict):
    m["updated_at"] = datetime.now(timezone.utc).isoformat()
    store.put(f"manifests/{layer}.json", json.dumps(m, indent=1).encode(), "application/json")


def fetch_surface(layer: str, region: str, when, http: httpx.Client, ds) -> Grid:
    """Download one day (or the newest) of a surface layer, in display units. Nothing is saved."""
    if ds.erddap == "copernicus":
        from . import copernicus
        raw = (copernicus.fetch_sst if layer == "sst" else copernicus.fetch_chl)(REGIONS[region], when)
    else:
        raw = fetch_grid(ds, REGIONS[region], when, http=http)
    return to_display_units(raw)


def grid_day(g: Grid) -> str:
    return (g.meta.get("observed_at") or datetime.now(timezone.utc).isoformat())[:10]


def process_surface(layer: str, region: str, when, http: httpx.Client, store, ds=None, grid: Grid | None = None) -> dict:
    ds = ds or DATASETS[layer]
    g = grid if grid is not None else fetch_surface(layer, region, when, http, ds)
    day = (g.meta.get("observed_at") or datetime.now(timezone.utc).isoformat())[:10]
    base = f"{layer}/{region}/{day}"
    store.put(f"grids/{base}.npz", g.to_bytes())

    cmap = SST_F if layer == "sst" else CHL
    colorize = lambda v: apply(v, cmap, 255)  # noqa: E731 (opacity is applied in the app)
    # Clean coastline: fill the coastal strip the satellite grid leaves empty, then cut exactly at the real shore.
    from . import landmask
    mask = landmask.get(region, REGIONS[region], store, http, log)
    draw, cut = g, None
    if mask is not None:
        # Gap-free products (water temp, Copernicus chlorophyll): fill every no-data cell so color reaches the shore
        # everywhere (land is cut off exactly below). Cloudy NOAA chlorophyll: only the strip next to real data.
        reach = 3 if ds.kind == "observed" else 10_000
        draw = Grid(g.lats, g.lons, landmask.fill_gaps(g.values, max_cells=reach), g.meta)
        cut = lambda v, lat, lon: np.where(mask.is_land(lat, lon), np.nan, v)  # noqa: E731
    n = 0
    for z in TILE_ZOOMS[layer]:
        for zz, x, y in tiles_for_bbox(REGIONS[region], z):
            png = render(draw, zz, x, y, colorize, cut)
            if png:
                store.put(f"tiles/{base}/{zz}/{x}/{y}.png", png, "image/png")
                n += 1
    b = BREAKS[layer]
    fc = break_lines(g, b["moderate"], b["strong"], b["interval"], log10=(layer == "chl"))
    store.put(f"vectors/{layer}-breaks/{region}/{day}.geojson", json.dumps(fc).encode(), "application/geo+json")
    log(f"{layer} {day}: {n} tiles, {len(fc['features'])} break groups")
    return {
        "date": day, "observed_at": g.meta.get("observed_at"), "region": region,
        "tiles": store.url(f"tiles/{base}") + "/{z}/{x}/{y}.png",
        "breaks": store.url(f"vectors/{layer}-breaks/{region}/{day}.geojson"),
        "grid": f"grids/{base}.npz", "tile_count": n,
    }


def _note(layer: str, ds) -> str:
    if layer == "sst" and ds.erddap == "copernicus":
        from .copernicus import CREDIT
        return f"Satellite blend with cloud gaps filled in (about 5 km detail; used because it's newer than NOAA's 1 km map today). {CREDIT}."
    if layer == "chl" and ds.erddap == "copernicus":
        from .copernicus import CREDIT
        return f"Satellite blend from several satellites with cloud gaps filled in. {CREDIT}."
    return NOTES[layer]


def chl_candidates(http: httpx.Client):
    """The configured chlorophyll dataset first, then the fallbacks, each shaped to what the server says it has
    (variable name and dimensions differ between NOAA's chlorophyll products)."""
    from dataclasses import replace
    from .erddap import describe
    from .registry import CHL_FALLBACKS
    base = DATASETS["chl"]
    from . import copernicus
    if copernicus.enabled():   # first choice: complete map every day, clouds filled in
        yield replace(base, erddap="copernicus", dataset_id=copernicus.CHL_DATASET, variable="CHL",
                      kind="interpolated", resolution_m=4000, source=copernicus.SOURCE, verified=True)
    else:
        log("chl: Copernicus login not set (COPERNICUSMARINE_SERVICE_USERNAME / _PASSWORD), using NOAA")
    seen = []
    for ds_id in [base.dataset_id, *CHL_FALLBACKS]:
        if ds_id in seen:
            continue
        seen.append(ds_id)
        try:
            dims, vars_ = describe(base.erddap, ds_id, http)
        except Exception as e:
            log(f"chl: {ds_id} not available ({e})")
            continue
        var = base.variable if base.variable in vars_ else next((v for v in vars_ if "chl" in v.lower()), None)
        if not var:
            log(f"chl: {ds_id} has no chlorophyll variable")
            continue
        fixed = {d: 0.0 for d in dims if d not in ("time", "latitude", "longitude")}
        yield replace(base, dataset_id=ds_id, variable=var, dims=tuple(dims), fixed=fixed)


UPWELL = "https://upwell.pfeg.noaa.gov/erddap"   # NOAA ERD's second ERDDAP server (same data as coastwatch.pfeg)


def sst_candidates():
    """NOAA MUR (1 km) on the main server, then on NOAA's second server, then Copernicus OSTIA (5 km).
    NOAA sometimes blocks the shared GitHub machine addresses (HTTP 403 "blacklist"), so one source is not enough."""
    from dataclasses import replace
    from . import copernicus
    base = DATASETS["sst"]
    yield base
    if base.erddap.rstrip("/") != UPWELL:
        yield replace(base, erddap=UPWELL)
    if copernicus.enabled():
        yield replace(base, erddap="copernicus", dataset_id=copernicus.SST_DATASET, variable="analysed_sst",
                      units="K", resolution_m=5500, source=copernicus.SST_SOURCE)


def pick_freshest(found: list) -> int:
    """Index of the source with the newest day. On a tie the earlier (sharper, preferred) source wins."""
    best = 0
    for i, (_, day) in enumerate(found):
        if day > found[best][1]:
            best = i
    return best


def _latest_surface(layer: str, region: str, http: httpx.Client, store):
    if layer not in ("sst", "chl"):
        return DATASETS[layer], process_surface(layer, region, "last", http, store)
    if layer == "sst":
        # Water temp: the 1 km NASA/NOAA map is sharpest but often 2-3 days behind; Copernicus usually has yesterday.
        # Ask every source for its newest day, then publish the freshest (ties go to the sharper map).
        found, last_err = [], None
        for ds in sst_candidates():
            if found and ds.erddap != "copernicus" and found[-1][0].dataset_id == ds.dataset_id:
                continue   # same NOAA map on the backup server: only needed if the first server failed
            try:
                g = fetch_surface(layer, region, "last", http, ds)
                found.append((ds, grid_day(g), g))
                log(f"sst: {ds.dataset_id} on {ds.erddap} has {grid_day(g)}")
            except Exception as e:
                last_err = e
                log(f"sst: {ds.dataset_id} on {ds.erddap} failed ({str(e)[:200]})")
        if not found:
            raise RuntimeError(f"No sst source worked. Last error: {last_err}")
        i = pick_freshest([(ds, day) for ds, day, _ in found])
        ds, day, g = found[i]
        log(f"sst: using {ds.dataset_id} ({day}) — newest of {', '.join(d for _, d, _ in found)}")
        return ds, process_surface(layer, region, "last", http, store, ds, grid=g)
    last_err = None
    for ds in (sst_candidates() if layer == "sst" else chl_candidates(http)):
        try:
            entry = process_surface(layer, region, "last", http, store, ds)
            log(f"{layer}: using {ds.dataset_id} on {ds.erddap}")
            return ds, entry
        except Exception as e:
            last_err = e
            log(f"{layer}: {ds.dataset_id} on {ds.erddap} failed ({str(e)[:200]})")
    raise RuntimeError(f"No {layer} source worked. Last error: {last_err}")


def run_surface(layer: str, region: str, days: list[int]):
    store = get_store()
    http = httpx.Client(timeout=180, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
    m = _manifest(store, layer)
    m["dates"] = [d for d in m.get("dates", []) if d.get("tiles")]   # drop broken entries (Oct 20 test-data bug)
    have = {d["date"] for d in m["dates"]}
    ds, latest = _latest_surface(layer, region, http, store)
    entries = [latest]
    latest_day = date.fromisoformat(latest["date"])
    for back in sorted(set(days) - {0}):
        d = (latest_day - timedelta(days=back)).isoformat()
        if d in have:
            continue
        try:
            entries.append(process_surface(layer, region, d, http, store, ds))
        except Exception as e:  # one missing day shouldn't stop the run
            log(f"{layer} {d}: skipped ({e})")
    by_date = {d["date"]: d for d in m["dates"]}
    by_date.update({e["date"]: e for e in entries})
    m.update({
        "label": LABELS[layer], "note": _note(layer, ds), "legend": LEGENDS[layer], "kind": ds.kind,
        "source": ds.source, "dataset": ds.dataset_id, "resolution_m": ds.resolution_m, "verified": ds.verified,
        "dates": sorted(by_date.values(), key=lambda e: e["date"], reverse=True)[:KEEP_DAYS],
        "breaks_thresholds": BREAKS[layer],
    })
    _save_manifest(store, layer, m)


def run_bathy(region: str, file: str | None):
    store = get_store()
    if file:
        g = _load_local_dem(file)
    else:
        g = fetch_grid(DATASETS["bathy"], REGIONS[region], None, http=httpx.Client(timeout=300, follow_redirects=True))
    depth = to_display_units(g)
    depth.meta.update({"layer": "bathy"})
    _, hs, slope = bathy_mod.shaded_grid(depth)
    store.put(f"grids/bathy/{region}/depth.npz", depth.to_bytes())
    n = 0
    for z in TILE_ZOOMS["bathy"]:
        for zz, x, y in tiles_for_bbox(REGIONS[region], z):
            lon, lat = pixel_lonlat(zz, x, y)
            d = depth.sample(lat, lon)
            if not np.isfinite(d).any():
                continue
            rgba = bathy_mod.colorize_relief(d, hs.sample(lat, lon), slope.sample(lat, lon))
            buf = io.BytesIO()
            Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
            store.put(f"tiles/bathy/{region}/{zz}/{x}/{y}.png", buf.getvalue(), "image/png")
            n += 1
    contours = bathy_mod.contour_geojson(depth)
    store.put(f"vectors/bathy-contours/{region}.geojson", json.dumps(contours).encode(), "application/geo+json")
    _save_manifest(store, "bathy", {
        "layer": "bathy", "label": LABELS["bathy"], "note": NOTES["bathy"], "legend": LEGENDS["bathy"],
        "kind": "static", "source": depth.meta.get("source"), "dataset": depth.meta.get("dataset"),
        "resolution_m": depth.meta.get("resolution_m"),
        "dates": [{"date": "static", "region": region, "tiles": store.url(f"tiles/bathy/{region}") + "/{z}/{x}/{y}.png",
                   "contours": store.url(f"vectors/bathy-contours/{region}.geojson"), "grid": f"grids/bathy/{region}/depth.npz",
                   "tile_count": n}],
    })
    log(f"bathy: {n} tiles, {len(contours['features'])} contour levels")


def _load_local_dem(path: str) -> Grid:
    """High-resolution seafloor file (e.g. NOAA Southern California Coastal Relief Model).
    GeoTIFF needs `pip install rasterio`; .npz must contain lats, lons, values (meters, up positive)."""
    if path.endswith(".npz"):
        z = np.load(path)
        return Grid(z["lats"], z["lons"], z["values"], {"layer": "bathy", "units": "m", "source": "NOAA NCEI (local file)", "dataset": path, "resolution_m": 90})
    import rasterio  # optional
    with rasterio.open(path) as src:
        arr = src.read(1).astype(np.float32)
        if src.nodata is not None:
            arr[arr == src.nodata] = np.nan
        t = src.transform
        lons = t.c + t.a * (np.arange(src.width) + 0.5)
        lats = t.f + t.e * (np.arange(src.height) + 0.5)
        res = abs(t.a) * 111_320
    return Grid(lats, lons, arr, {"layer": "bathy", "units": "m", "source": "NOAA NCEI (local file)", "dataset": path, "resolution_m": res})


def discover():
    """Lists the datasets NOAA currently offers (newest data first), so a renamed one can be swapped in."""
    from .erddap import list_datasets
    http = httpx.Client(timeout=90, follow_redirects=True)
    for erddap in ("https://coastwatch.pfeg.noaa.gov/erddap", "https://coastwatch.noaa.gov/erddap", "https://polarwatch.noaa.gov/erddap"):
        for label, rx in (("sea surface temperature", "(?i).*(sea surface temperature|SST).*"), ("chlorophyll", "(?i).*chlorophyll.*")):
            try:
                found = list_datasets(erddap, rx, http)
            except Exception as e:
                log(f"{erddap} {label}: {e}")
                continue
            print(f"\n== {erddap} :: {label} ({len(found)} datasets, newest first)")
            for f in found[:20]:
                print(f"  {f['id']:<45} data to {f['max_time'][:10]:<10}  {f['title'][:80]}")
    print("\nSet SST_DATASET / CHL_DATASET (and _VARIABLE / _ERDDAP) to pick one, then run `verify`.")


def verify():
    http = httpx.Client(timeout=120, follow_redirects=True)
    ok = True
    for key, ds in DATASETS.items():
        lon, lat = -118.0, 33.4
        box = (lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1)
        try:
            g = fetch_grid(ds, box, None if key == "bathy" else "last", http=http)
            n = int(np.isfinite(g.values).sum())
            log(f"OK   {key:<6} {ds.dataset_id}: {n} values, observed {g.meta.get('observed_at')}")
        except Exception as e:
            ok = False
            log(f"FAIL {key:<6} {ds.dataset_id}: {e}")
    sys.exit(0 if ok else 1)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("job", choices=["sst", "chl", "bathy", "wind", "rules", "harbors", "all", "discover", "verify"])
    p.add_argument("--region", default="socal")
    p.add_argument("--days", default="0,1,2,3,7")
    p.add_argument("--file", default=None, help="local seafloor file for `bathy`")
    a = p.parse_args(argv)
    days = [int(x) for x in a.days.split(",") if x.strip()]
    if a.job == "discover":
        return discover()
    if a.job in ("rules", "harbors"):
        failed_weekly = []
        if a.job == "rules":
            from rules.job import run as run_rules
            m = run_rules(get_store(), REGIONS[a.region], log)
            log(f"rules: {sum(1 for l in m['layers'] if l.get('available'))}/{len(m['layers'])} layers available")
        try:   # harbors ride along with the weekly rules job
            from harbors.job import run as run_harbors
            run_harbors(get_store(), log)
        except Exception as e:
            failed_weekly.append("harbors")
            log(f"FAILED harbors: {e}")
        if failed_weekly:
            sys.exit(1)
        return
    if a.job == "wind":
        from .wind import run as run_wind
        m = run_wind(get_store(), REGIONS[a.region], a.region)
        return log(f"wind: run {m['run']}, {len(m['hours'])} forecast hours")
    if a.job == "verify":
        return verify()
    # One layer failing (e.g. NOAA renaming a dataset) must not stop the others from updating.
    failed = []

    def step(name, fn, *args):
        try:
            fn(*args)
        except Exception as e:
            failed.append(name)
            log(f"FAILED {name}: {e}")

    if a.job in ("sst", "all"):
        step("sst", run_surface, "sst", a.region, days)
    if a.job in ("chl", "all"):
        step("chl", run_surface, "chl", a.region, days)
    if a.job == "bathy" or (a.job == "all" and get_store().get(f"manifests/bathy.json") is None):
        step("bathy", run_bathy, a.region, a.file)
    if failed:
        log(f"Finished with failures: {', '.join(failed)} (the other layers were updated)")
        sys.exit(1)


if __name__ == "__main__":
    main()
