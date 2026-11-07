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
from .registry import BREAKS, DATASETS, REGIONS, TILE_ZOOMS, break_settings
from .tiles import pixel_lonlat, render, tiles_for_bbox

KEEP_DAYS = 14
LEGENDS = {
    "sst": legend(SST_F, "°F", [54, 58, 62, 66, 70, 74, 78]),
    "chl": legend(CHL, "mg/m³", [0.05, 0.1, 0.2, 0.5, 1, 2, 5]),
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


RUN_STAMP = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")   # one per job run


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


def process_surface(layer: str, region: str, when, http: httpx.Client, store, ds=None, grid: Grid | None = None, tag: str = "",
                    seen: np.ndarray | None = None) -> dict:
    ds = ds or DATASETS[layer]
    g = grid if grid is not None else fetch_surface(layer, region, when, http, ds)
    day = (g.meta.get("observed_at") or datetime.now(timezone.utc).isoformat())[:10]
    # Nov 7: today's-passes maps (tag "-live") get their own pictures, so the daily job can't paint over them
    base = f"{layer}/{region}/{day}{tag}"
    store.put(f"grids/{base}.npz", g.to_bytes())

    cmap = sst_scale(g) if layer == "sst" else CHL
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
    b = break_settings(layer, ds.resolution_m)
    water = _break_water(g, mask, b.get("coast_nm", 0.0), seen)
    if b.get("ranked"):   # water temp: every line tagged with its strength; the app picks how many to show
        from .breaks import break_lines_ranked
        fc = break_lines_ranked(g, b["moderate"], b["strong"], b["interval"], sigma_cells=b["sigma"], water=water,
                                min_span_nm=b.get("min_len_nm", 2.0))
    else:
        fc = break_lines(g, b["moderate"], b["strong"], b["interval"], log10=(layer == "chl"), sigma_cells=b["sigma"],
                         water=water, min_len_nm=b.get("min_len_nm", 0.0))
    store.put(f"vectors/{layer}-breaks/{region}/{day}{tag}.geojson", json.dumps(fc).encode(), "application/geo+json")
    log(f"{layer} {day}: {n} tiles, {len(fc['features'])} break groups")
    return {
        "date": day, "observed_at": g.meta.get("observed_at"), "region": region,
        # ?v= changes every run, so phones and the CDN fetch the redrawn map right away instead of a saved copy
        # (the pictures are kept for a day, and a same-day redraw would otherwise not show until tomorrow).
        "tiles": store.url(f"tiles/{base}") + "/{z}/{x}/{y}.png?v=" + RUN_STAMP,
        "breaks": store.url(f"vectors/{layer}-breaks/{region}/{day}{tag}.geojson") + "?v=" + RUN_STAMP,
        "grid": f"grids/{base}.npz", "tile_count": n,
        **({"legend": legend(cmap, "°F", sst_ticks(cmap))} if layer == "sst" else {}),
    }


def sst_scale(g: Grid) -> dict:
    """Nov 2: the water-temp colors stretched over THIS day's temperatures. With a fixed 54–78 °F scale, a typical
    day spans only a few degrees, so the whole sea came out one or two colors. Now the full rainbow covers the day's
    real range (2nd–98th percentile, at least 8 °F wide), so every 1/3 °F shows as its own band and breaks pop."""
    v = np.asarray(g.values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size < 50:
        return SST_F
    lo, hi = np.percentile(v, 2), np.percentile(v, 98)
    lo, hi = float(np.floor(lo)), float(np.ceil(hi))
    if hi - lo < 8:
        mid = (lo + hi) / 2
        lo, hi = float(np.floor(mid - 4)), float(np.floor(mid - 4) + 8)
    lo, hi = max(40.0, lo), min(90.0, hi)
    return {**SST_F, "min": lo, "max": hi}


def sst_ticks(cmap: dict) -> list:
    lo, hi = cmap["min"], cmap["max"]
    step = 1 if hi - lo <= 8 else 2 if hi - lo <= 16 else 4
    return [float(t) for t in np.arange(lo, hi + 0.01, step)]


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
        save_base(store, layer, region, g, ds)
        return ds, process_surface(layer, region, "last", http, store, ds, grid=g)
    # Chlorophyll (Nov 2): the cloud-free Copernicus map runs ~3 days behind; NOAA's daily satellite maps are ~1 day
    # old but have holes wherever it was cloudy. Ask every source for its newest day, use the NEWEST one, and fill its
    # cloud holes from the next-newest maps — so clear water shows yesterday's pass, cloudy patches the latest
    # cloud-free view.
    found, last_err = [], None
    for ds in chl_candidates(http):
        try:
            g = fetch_surface(layer, region, "last", http, ds)
            found.append((ds, grid_day(g), g))
            log(f"chl: {ds.dataset_id} on {ds.erddap} has {grid_day(g)} ({coverage(g):.0%} of the box seen)")
        except Exception as e:
            last_err = e
            log(f"chl: {ds.dataset_id} on {ds.erddap} failed ({str(e)[:200]})")
    if not found:
        raise RuntimeError(f"No chl source worked. Last error: {last_err}")
    order = sorted(range(len(found)), key=lambda i: (found[i][1], coverage(found[i][2])), reverse=True)
    ds, day, g = found[order[0]]
    used = [ds.dataset_id]
    for i in order[1:]:
        if coverage(g) >= 0.97:
            break
        before = coverage(g)
        g = fill_gaps(g, found[i][2])
        if coverage(g) > before + 0.01:
            used.append(f"{found[i][0].dataset_id} ({found[i][1]})")
    if len(used) > 1:
        from dataclasses import replace
        g.meta["filled_from"] = used[1:]
        ds = replace(ds, source=f"{ds.source} — cloud gaps filled from older cloud-free maps")
    log(f"chl: using {used[0]} ({day}){' + gaps from ' + ', '.join(used[1:]) if len(used) > 1 else ''} — newest of {', '.join(d for _, d, _ in found)}")
    save_base(store, layer, region, g, ds)
    if coverage(g) < 0.999:   # Nov 6: no blank clouds — fill what's left so it blends in with the water around it
        from dataclasses import replace
        from .passes import blend
        g = blend(g, None, log_space=True)
        ds = replace(ds, kind="interpolated", source=f"{ds.source} — remaining cloud gaps blended in")
    return ds, process_surface(layer, region, "last", http, store, ds, grid=g)


def coverage(g: Grid) -> float:
    """Share of the grid that has a value (water the satellite saw; land and clouds are empty)."""
    v = np.asarray(g.values)
    return float(np.isfinite(v).mean()) if v.size else 0.0


def fill_gaps(newer: Grid, older: Grid) -> Grid:
    """newer, with its empty cells (clouds) filled from `older` sampled at the same points."""
    la, lo = np.meshgrid(np.asarray(newer.lats), np.asarray(newer.lons), indexing="ij")
    o = np.asarray(older.sample(la, lo), dtype=np.float64)
    v = np.asarray(newer.values, dtype=np.float64)
    out = np.where(np.isfinite(v), v, o)
    return Grid(newer.lats, newer.lons, out.astype(np.asarray(newer.values).dtype), dict(newer.meta))


def _break_water(g: Grid, mask, coast_nm: float, seen: np.ndarray | None) -> np.ndarray | None:
    """Nov 7: where breaks may be drawn — water only, not the strip right along the shore (where land blurs into the
    satellite pixels), and (for today's passes) only where a satellite actually saw the water, not filled-in clouds."""
    ok = np.ones(g.values.shape, dtype=bool)
    if mask is not None:
        la, lo = np.meshgrid(g.lats, g.lons, indexing="ij")
        land = np.asarray(mask.is_land(la, lo), dtype=bool)
        ok &= ~land
        if coast_nm > 0 and land.any():
            from scipy.ndimage import distance_transform_edt
            cell_nm = max(float(abs(g.lats[1] - g.lats[0])) * 60.0, 1e-6)
            ok &= distance_transform_edt(~land) * cell_nm > coast_nm
    if seen is not None and seen.shape == ok.shape:
        ok &= seen
    return ok


def save_base(store, layer: str, region: str, g: Grid, ds):
    """Keep the latest regular daily map: today's satellite passes fill their cloud gaps from it (passes job)."""
    if store is None:
        return
    try:   # never let this stop the daily map
        store.put(f"grids/{layer}/{region}/base.npz", g.to_bytes())
        store.put(f"grids/{layer}/{region}/base.json", json.dumps({"dataset": ds.dataset_id, "source": ds.source, "kind": ds.kind,
                                                                  "erddap": ds.erddap, "day": grid_day(g)}).encode(), "application/json")
    except Exception as e:
        log(f"{layer}: couldn't keep the daily map for today's passes ({e})")


def run_passes(layer: str, region: str, now: datetime | None = None):
    """Nov 6: today's satellite passes (ocean/passes.py) → the newest map, refreshed through the day.
    preview mode: build it and report on the admin page only; on: publish it as today's map in the app."""
    from dataclasses import replace
    from . import passes
    store = get_store()
    http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "ChannelNav/1.0 (satellite passes)"})
    auth = passes.earthdata_client()
    report = {"layer": layer, "checked_at": datetime.now(timezone.utc).isoformat(), "mode": passes.mode(), "login": bool(auth)}
    try:
        if not auth:
            report["error"] = "No NASA Earthdata login saved in GitHub (EARTHDATA_USERNAME / EARTHDATA_PASSWORD)"
            log(f"passes {layer}: {report['error']}")
            return report
        comp = passes.composite(layer, region, REGIONS[region], http, auth, store, now, log)
        if comp is None:
            report["error"] = "No new passes over SoCal yet" + (" (chlorophyll needs daylight)" if layer == "chl" else "")
            log(f"passes {layer}: {report['error']}")
            return report
        report.update({k: comp.meta.get(k) for k in ("observed_at", "passes", "fresh_share", "today_share")})
        log(f"passes {layer}: {len(comp.meta['passes'])} passes, newest {comp.meta['observed_at']}, "
            f"{comp.meta['fresh_share']:.0%} of the box seen today")
        raw, info = store.get(f"grids/{layer}/{region}/base.npz"), store.get(f"grids/{layer}/{region}/base.json")
        base_info = json.loads(info) if info else {}
        # Nov 6: no blank clouds — fill them from the daily map, shifted to match today, with soft edges
        g = passes.blend(comp, Grid.from_bytes(raw) if raw else None, log_space=(layer == "chl"))
        if report["mode"] != "on":
            log(f"passes {layer}: preview only (set the GitHub variable PASSES to on to publish)")
            return report
        sats = sorted({p["sat"] for p in comp.meta["passes"] if p.get("sat")})
        ds = replace(DATASETS[layer], dataset_id="passes", resolution_m=750,
                     kind="interpolated",   # gap-free now: colors run right up to the shore everywhere
                     source=f"Today's satellite passes ({', '.join(sats)}) via NASA Earthdata"
                            + (f"; clouds filled from {base_info.get('source', 'the daily map')} ({base_info.get('day', '')}), matched to today" if raw else "; clouds filled from the water around them"))
        entry = process_surface(layer, region, "last", http, store, ds, grid=g, tag="-live",
                                seen=np.isfinite(comp.values) if layer == "sst" else None)
        entry.update({"passes": comp.meta["passes"], "fresh_share": comp.meta["fresh_share"], "live": True, "source": ds.source})
        m = _manifest(store, layer)
        by_date = {d["date"]: d for d in m.get("dates", []) if d.get("tiles")}
        by_date[entry["date"]] = entry
        m["dates"] = sorted(by_date.values(), key=lambda e: e["date"], reverse=True)[:KEEP_DAYS]
        _save_manifest(store, layer, m)
        report["published"] = entry["date"]
        return report
    except PermissionError as e:
        report["error"] = str(e)
        log(f"passes {layer}: {e}")
        return report
    finally:
        store.put(f"manifests/passes-{layer}.json", json.dumps(report).encode(), "application/json")


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
    for e in entries:   # Nov 7: never replace a newer today's-passes map with an older daily map of the same day
        old = by_date.get(e["date"])
        if old and old.get("live") and (old.get("observed_at") or "") >= (e.get("observed_at") or ""):
            continue
        by_date[e["date"]] = e
    m.update({
        "label": LABELS[layer], "note": _note(layer, ds), "legend": LEGENDS[layer], "kind": ds.kind,
        "source": ds.source, "dataset": ds.dataset_id, "resolution_m": ds.resolution_m, "verified": ds.verified,
        "dates": sorted(by_date.values(), key=lambda e: e["date"], reverse=True)[:KEEP_DAYS],
        "breaks_thresholds": break_settings(layer, ds.resolution_m),
    })
    _save_manifest(store, layer, m)


def _thin(g: Grid, k: int) -> Grid:
    """Every k-th row/column (for the stored lookup grid and the vector contours, which must stay small)."""
    return g if k <= 1 else Grid(g.lats[::k].copy(), g.lons[::k].copy(), g.values[::k, ::k].copy(), dict(g.meta))


def run_bathy(region: str, file: str | None, grid: Grid | None = None, extra: dict | None = None, zooms=None):
    """Seafloor relief tiles + depth lookup grid + vector contours. `grid` (meters, up positive) = use this data
    (e.g. the Coastal Relief Model from `crm`) instead of the coarse global grid. `extra` goes into the manifest."""
    store = get_store()
    if grid is not None:
        g = grid
    elif file:
        g = _load_local_dem(file)
    else:
        g = fetch_grid(DATASETS["bathy"], REGIONS[region], None, http=httpx.Client(timeout=300, follow_redirects=True))
    depth = to_display_units(g)
    depth.meta.update({"layer": "bathy"})
    _, hs, slope = bathy_mod.shaded_grid(depth)
    # the stored lookup grid (tap-for-depth, catch snapshots) and the vector contours stay ~300 m / ~700 m
    fine_m = float(depth.meta.get("resolution_m") or 1850)
    store.put(f"grids/bathy/{region}/depth.npz", _thin(depth, max(1, int(round(270 / fine_m)))).to_bytes())
    n = 0
    for z in (zooms or TILE_ZOOMS["bathy"]):
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
    contours = bathy_mod.contour_geojson(_thin(depth, max(1, int(round(700 / fine_m)))))
    store.put(f"vectors/bathy-contours/{region}.geojson", json.dumps(contours).encode(), "application/geo+json")
    _save_manifest(store, "bathy", {
        "layer": "bathy", "label": LABELS["bathy"], "note": NOTES["bathy"], "legend": LEGENDS["bathy"],
        "kind": "static", "source": depth.meta.get("source"), "dataset": depth.meta.get("dataset"),
        "resolution_m": depth.meta.get("resolution_m"),
        "dates": [{"date": "static", "region": region, "tiles": store.url(f"tiles/bathy/{region}") + "/{z}/{x}/{y}.png",
                   "contours": store.url(f"vectors/bathy-contours/{region}.geojson"), "grid": f"grids/bathy/{region}/depth.npz",
                   "tile_count": n, **(extra or {})}],
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
    p.add_argument("job", choices=["sst", "chl", "surface", "bathy", "wind", "rules", "harbors", "navmask", "navmask-rebuild", "bottomhd", "bottomhd-socal", "bottomhd-rebuild", "bottomhd-preview", "bottomhd-overview", "bottomhd-restore", "bottomhd-restore-v3", "bottomhd-restore-v4", "bottomhd-restore-v5", "bottomhd-restore-v6", "crm", "crm-rebuild", "regs", "regs-undo", "passes", "all", "discover", "verify"])
    p.add_argument("--region", default="socal")
    p.add_argument("--days", default="0,1,2,3,7")
    p.add_argument("--file", default=None, help="local seafloor file for `bathy`")
    p.add_argument("--force", action="store_true", help="navmask: rebuild every tile instead of continuing")
    p.add_argument("--version", default="legacy", help="bottomhd-restore: which saved build to show (legacy, v3, v4, v5)")
    p.add_argument("--area", default="pilot", help="bottomhd: which area to draw (see ocean/bottomhd.py AREAS)")
    a = p.parse_args(argv)
    days = [int(x) for x in a.days.split(",") if x.strip()]
    if a.job == "discover":
        return discover()
    if a.job in ("crm", "crm-rebuild"):   # sharper seafloor + Standard/Max contour layers for the whole region
        from .crm import run as run_crm
        http = httpx.Client(timeout=300, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
        return run_crm(get_store(), a.region, http, log, force=a.force or a.job == "crm-rebuild")
    if a.job.startswith("bottomhd-restore"):   # switch the app back to an earlier HD bottom build (nothing is redrawn)
        from .bottomhd import restore
        version = a.job[len("bottomhd-restore-"):] if a.job.startswith("bottomhd-restore-") else a.version
        return None if restore(get_store(), a.area, version, log) else sys.exit(1)
    if a.job == "bottomhd-overview":   # zoomed-out HD squares for pilot + all-SoCal (fast; nothing redrawn)
        from .bottomhd import overview_only
        st = get_store()
        return overview_only(st, "pilot", log) | overview_only(st, "socal", log)
    if a.job == "bottomhd-preview":   # side-by-side picture of the old vs new HD bottom at real spots (app unchanged)
        from .bottomhd import preview
        http = httpx.Client(timeout=300, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
        preview(get_store(), a.area, http, log, out_path="bottomhd-preview.png")
        return None
    if a.job in ("bottomhd", "bottomhd-socal", "bottomhd-rebuild"):   # HD bottom (resumable; keeps going run after run)
        from .bottomhd import run as run_bottomhd
        http = httpx.Client(timeout=300, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
        area = "socal" if a.job == "bottomhd-socal" else a.area
        return run_bottomhd(get_store(), area, http, log, force=a.force or a.job == "bottomhd-rebuild")
    if a.job in ("navmask", "navmask-rebuild"):   # water map for auto routing (resumable; "-rebuild" starts over)
        from navroute.build import run as run_navmask
        http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
        return run_navmask(get_store(), REGIONS[a.region], a.region, http, log, force=a.force or a.job == "navmask-rebuild")
    if a.job == "passes":   # Nov 6: today's satellite passes, chlorophyll + water temp (hourly in the daytime)
        for layer in ("sst", "chl"):
            try:
                run_passes(layer, a.region)
            except Exception as e:
                import traceback
                log(f"FAILED passes {layer}: {type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}")
                store_err = get_store()
                store_err.put(f"manifests/passes-{layer}.json", json.dumps({"layer": layer, "checked_at": datetime.now(timezone.utc).isoformat(),
                              "mode": "on", "error": f"Failed: {type(e).__name__}: {str(e)[:200]}"}).encode(), "application/json")
        return
    if a.job == "regs-undo":   # take back every automatic fish-rule change (hand-checked numbers show again)
        from regs.auto import undo
        return undo(get_store(), log)
    if a.job == "regs":   # Nov 3: fish size and bag limits — check the official CDFW pages for changes
        from regs.watch import run as run_regs
        http = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; ChannelNav rules check)"})
        return run_regs(get_store(), http, log)
    if a.job in ("rules", "harbors"):
        failed_weekly = []
        if a.job == "rules":
            from rules.job import run as run_rules
            m = run_rules(get_store(), REGIONS[a.region], log)
            log(f"rules: {sum(1 for l in m['layers'] if l.get('available'))}/{len(m['layers'])} layers available")
        try:   # Nov 3: fish size and bag limits are checked against CDFW every week too
            from regs.watch import run as run_regs
            run_regs(get_store(), httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; ChannelNav rules check)"}), log)
        except Exception as e:
            failed_weekly.append("regs")
            log(f"FAILED regs: {e}")
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

    if a.job in ("sst", "all", "surface"):
        step("sst", run_surface, "sst", a.region, days)
    if a.job in ("chl", "all", "surface"):
        step("chl", run_surface, "chl", a.region, days)
    if a.job == "bathy" or (a.job == "all" and get_store().get(f"manifests/bathy.json") is None):
        step("bathy", run_bathy, a.region, a.file)
    if failed:
        log(f"Finished with failures: {', '.join(failed)} (the other layers were updated)")
        sys.exit(1)


if __name__ == "__main__":
    main()
