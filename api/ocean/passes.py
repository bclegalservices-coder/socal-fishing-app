"""Today's satellite passes (Nov 6): chlorophyll and water temperature from each satellite pass as soon as NASA
publishes it (usually a few hours after the satellite flies over), instead of waiting for the next day's finished map.

  Chlorophyll – NASA near-real-time Level-2 ocean color: VIIRS on Suomi-NPP, NOAA-20 and NOAA-21, MODIS on Aqua,
                and PACE. Daylight only (it's a color picture), so new passes arrive around midday.
  Water temp  – NOAA ACSPO VIIRS SST (Suomi-NPP, NOAA-20, NOAA-21), day AND night passes, ~750 m. GOES-West
                (geostationary, every hour, ~2 km) fills cloud gaps the sharper VIIRS passes didn't see.

How a map is made:
  1. Ask NASA's public catalog (CMR) for passes over SoCal in the last day.
  2. Download each NEW pass once (free NASA Earthdata login), put its pixels on our 0.01° (~1 km) grid, and keep the
     result, so later runs only download passes they haven't seen.
  3. Stack them oldest → newest: wherever a pass saw clear water, it replaces what was there. Newest wins.
  4. Clouds that hid the water in every pass are filled from the regular daily map (marked as older in the app).

Mode (GitHub variable PASSES): "preview" (default) = build and report on the admin page, publish nothing;
"on" = publish to the app. Login: GitHub secrets EARTHDATA_USERNAME + EARTHDATA_PASSWORD (or EARTHDATA_TOKEN).
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

from .grid import Grid

CMR = "https://cmr.earthdata.nasa.gov/search"
URS = "urs.earthdata.nasa.gov"
RES = float(os.environ.get("PASSES_RES", "0.01"))          # grid spacing in degrees (~1 km)

# What to look for in NASA's catalog (short names; * = any). Overridable without code changes.
COLLECTIONS = {
    "chl": [p.strip() for p in os.environ.get("PASSES_CHL", "VIIRSN_L2_OC_NRT,VIIRSJ1_L2_OC_NRT,VIIRSJ2_L2_OC_NRT,MODISA_L2_OC_NRT,PACE_OCI_L2_BGC_NRT*").split(",") if p.strip()],
    # Nov 6: NASA renamed the newest ones (e.g. N21-VIIRS-L2P-ACSPO-v2.80), so look for every naming style
    "sst": [p.strip() for p in os.environ.get("PASSES_SST", "*VIIRS-L2P-ACSPO*,VIIRS_*-OSPO-L2P-*,VIIRS_*-STAR-L2P-*").split(",") if p.strip()],
    "sst_fill": [p.strip() for p in os.environ.get("PASSES_SST_FILL", "ABI_G18-STAR-L3C-*,ABI_G19-STAR-L3C-*").split(",") if p.strip()],
}
HOURS = {"chl": 30, "sst": 24, "sst_fill": 8}               # how far back a pass still counts as "today"

SAT_NAMES = [("PACE", "PACE"), ("VIIRSJ2", "NOAA-21"), ("N21", "NOAA-21"), ("JPSS2", "NOAA-21"), ("VIIRSJ1", "NOAA-20"),
             ("N20", "NOAA-20"), ("JPSS1", "NOAA-20"), ("VIIRSN", "Suomi-NPP"), ("NPP", "Suomi-NPP"), ("SNPP", "Suomi-NPP"),
             ("MODISA", "Aqua"), ("AQUA", "Aqua"), ("G18", "GOES-West"), ("G19", "GOES-West")]

# Ocean-color quality flags that mean "don't trust this pixel" (NASA's standard chlorophyll mask).
BAD_FLAGS = {"ATMFAIL", "LAND", "HIGLINT", "HILT", "HISATZEN", "STRAYLIGHT", "CLDICE", "COCCOLITH", "HISOLZEN",
             "LOWLW", "CHLFAIL", "NAVWARN", "MAXAERITER", "CHLWARN", "NAVFAIL"}


def sat_name(text: str) -> str:
    t = text.upper()
    return next((n for k, n in SAT_NAMES if k in t), "Satellite")


def log_default(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ NASA login and catalog
def earthdata_client() -> httpx.Client | None:
    """httpx client that signs in to NASA Earthdata only when NASA's login server asks (never sends the password
    anywhere else). None if no login is saved."""
    user, pw = os.environ.get("EARTHDATA_USERNAME", "").strip(), os.environ.get("EARTHDATA_PASSWORD", "")
    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not (token or (user and pw)):
        return None
    basic = "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode() if user and pw else None

    def sign(req: httpx.Request):
        host = req.url.host
        if host == URS and basic:
            req.headers["Authorization"] = basic
        elif token and host.endswith("nasa.gov") and host != URS:
            req.headers["Authorization"] = f"Bearer {token}"

    return httpx.Client(timeout=300, follow_redirects=True, event_hooks={"request": [sign]},
                        headers={"User-Agent": "ChannelNav/1.0 (satellite passes)"})


def find_collections(http, patterns: list[str], log=log_default) -> list[dict]:
    """NASA catalog entries matching the short names (newest version of each)."""
    out: dict[str, dict] = {}
    for pat in patterns:
        try:
            r = http.get(f"{CMR}/collections.json", params={"short_name": pat, "options[short_name][pattern]": "true", "page_size": 50})
            r.raise_for_status()
            for e in r.json().get("feed", {}).get("entry", []):
                sn = e.get("short_name") or ""
                if sn and (sn not in out or str(e.get("version_id", "")) > str(out[sn].get("version_id", ""))):
                    out[sn] = {"id": e["id"], "short_name": sn, "version_id": e.get("version_id", "")}
        except Exception as ex:
            log(f"passes: catalog search {pat} failed ({type(ex).__name__}: {str(ex)[:120]})")
    return list(out.values())


def find_granules(http, coll: dict, bbox: tuple, start: datetime, end: datetime, log=log_default) -> list[dict]:
    w, s, e, n = bbox
    try:
        r = http.get(f"{CMR}/granules.json", params={
            "collection_concept_id": coll["id"], "bounding_box": f"{w},{s},{e},{n}",
            "temporal": f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')},{end.strftime('%Y-%m-%dT%H:%M:%SZ')}",
            "page_size": 100, "sort_key": "-start_date"})
        r.raise_for_status()
    except Exception as ex:
        log(f"passes: {coll['short_name']}: search failed ({type(ex).__name__})")
        return []
    out = []
    for g in r.json().get("feed", {}).get("entry", []):
        href = next((l.get("href") for l in g.get("links", []) if str(l.get("rel", "")).endswith("/data#")
                     and str(l.get("href", "")).startswith("https") and re.search(r"\.(nc|nc4|h5)$", str(l.get("href", "")))), None)
        if href and g.get("time_start"):
            out.append({"id": g.get("id") or g.get("title"), "title": g.get("title", ""), "at": g["time_start"],
                        "url": href, "collection": coll["short_name"], "sat": sat_name(coll["short_name"] + " " + g.get("title", ""))})
    return out


def download(auth: httpx.Client, url: str) -> bytes:
    r = auth.get(url)
    where = getattr(getattr(r, "url", None), "host", "") or ""
    if r.status_code in (401, 403) or "text/html" in r.headers.get("content-type", "") or r.content[:8] != b"\x89HDF\r\n\x1a\n":
        why = ("wrong NASA username or password" if where == URS and r.status_code == 401
               else "this NASA data site hasn't been approved for your login yet" if where == URS
               else f"NASA answered {r.status_code} from {where or 'the data site'}")
        raise PermissionError(f"NASA Earthdata said no ({why}). Fix: open this link once in your browser, sign in, "
                              f"and click Authorize/Agree if asked: {url}")
    r.raise_for_status()
    return r.content


# ------------------------------------------------------------------ reading the files (netCDF-4 = HDF5)
def _find(f, names: tuple[str, ...]):
    """First dataset anywhere in the file whose name is one of `names`."""
    hit = []

    def visit(path, obj):
        if not hit and hasattr(obj, "shape") and path.split("/")[-1] in names:
            hit.append(obj)
    f.visititems(visit)
    return hit[0] if hit else None


def _attr(ds, name, default=None):
    v = ds.attrs.get(name, default)
    if isinstance(v, np.ndarray) and v.size == 1:
        v = v.item()
    if isinstance(v, bytes):
        v = v.decode(errors="ignore")
    return v


def _values(ds, sel=Ellipsis) -> np.ndarray:
    a = np.asarray(ds[sel])
    fill = _attr(ds, "_FillValue")
    out = a.astype(np.float64)
    if fill is not None:
        out[a == fill] = np.nan
    sf, ao = _attr(ds, "scale_factor"), _attr(ds, "add_offset")
    if sf is not None:
        out = out * float(sf)
    if ao is not None:
        out = out + float(ao)
    return out


def read_pass(content: bytes, layer: str, bbox: tuple) -> tuple[np.ndarray, np.ndarray, np.ndarray] | Grid:
    """Pixels of one pass inside the box: (lat, lon, value) arrays, or a Grid for already-gridded GOES files.
    Chlorophyll in mg/m³, water temp in °F. Bad pixels (clouds, glint, low quality) are removed."""
    import h5py
    w, s, e, n = bbox
    with h5py.File(io.BytesIO(content), "r") as f:
        lat_ds, lon_ds = _find(f, ("latitude", "lat")), _find(f, ("longitude", "lon"))
        if lat_ds is None or lon_ds is None:
            raise ValueError("no latitude/longitude in file")
        if layer == "chl":
            v = _values(_find(f, ("chlor_a",)))
            lat, lon = np.asarray(lat_ds[...], float), np.asarray(lon_ds[...], float)
            flags = _find(f, ("l2_flags",))
            if flags is not None:
                masks = np.atleast_1d(np.asarray(flags.attrs.get("flag_masks", []))).astype(np.int64)
                names = str(_attr(flags, "flag_meanings", "")).split()
                bad = 0
                for m, nm in zip(masks, names):
                    if nm in BAD_FLAGS:
                        bad |= int(m)
                if bad:
                    v[(np.asarray(flags[...]).astype(np.int64) & bad) != 0] = np.nan
            v[(v <= 0.001) | (v > 100)] = np.nan
            return lat, lon, v
        sst = _find(f, ("sea_surface_temperature",))
        q = _find(f, ("quality_level",))
        if lat_ds.ndim == 1:      # gridded (GOES L3C): read only our box
            la, lo = np.asarray(lat_ds[...], float), np.asarray(lon_ds[...], float)
            ii = np.where((la >= s - 0.05) & (la <= n + 0.05))[0]
            jj = np.where((lo >= w - 0.05) & (lo <= e + 0.05))[0]
            if not ii.size or not jj.size:
                return Grid(np.array([s, n]), np.array([w, e]), np.full((2, 2), np.nan))
            sl = (slice(ii.min(), ii.max() + 1), slice(jj.min(), jj.max() + 1))
            sel = (0, *sl) if sst.ndim == 3 else sl
            v = _values(sst, sel)
            if q is not None:
                v[np.asarray(q[sel]) < 4] = np.nan
            v = _k_to_f(v, sst)
            return Grid(la[sl[0]], lo[sl[1]], v.astype(np.float32))
        v = _values(sst)
        if v.ndim == 3:
            v = v[0]
        if q is not None:
            qa = np.asarray(q[...])
            v[(qa[0] if qa.ndim == 3 else qa) < 4] = np.nan     # 4–5 = good/best (ACSPO)
        v = _k_to_f(v, sst)
        return np.asarray(lat_ds[...], float), np.asarray(lon_ds[...], float), v


def _k_to_f(v: np.ndarray, ds) -> np.ndarray:
    units = str(_attr(ds, "units", "kelvin")).lower()
    c = v - 273.15 if units.startswith("k") else v
    f = c * 9.0 / 5.0 + 32.0
    f[(f < 35) | (f > 95)] = np.nan
    return f


# ------------------------------------------------------------------ putting pixels on our grid
def target_grid(bbox: tuple, res: float = RES) -> tuple[np.ndarray, np.ndarray]:
    w, s, e, n = bbox
    return np.round(np.arange(s, n + res / 2, res), 6), np.round(np.arange(w, e + res / 2, res), 6)


def bin_pixels(lats: np.ndarray, lons: np.ndarray, lat, lon, val, log_space=False) -> np.ndarray:
    """Average every pixel that falls in each ~1 km cell (chlorophyll averaged on a log scale)."""
    lat, lon, val = np.ravel(lat), np.ravel(lon), np.ravel(val).astype(np.float64)
    res = float(lats[1] - lats[0])
    ok = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(val)
    ok &= (lat >= lats[0] - res / 2) & (lat <= lats[-1] + res / 2) & (lon >= lons[0] - res / 2) & (lon <= lons[-1] + res / 2)
    if log_space:
        ok &= val > 0
    out = np.full((lats.size, lons.size), np.nan)
    if not ok.any():
        return out
    i = np.clip(np.rint((lat[ok] - lats[0]) / res).astype(int), 0, lats.size - 1)
    j = np.clip(np.rint((lon[ok] - lons[0]) / res).astype(int), 0, lons.size - 1)
    v = np.log10(val[ok]) if log_space else val[ok]
    flat = i * lons.size + j
    tot = np.bincount(flat, weights=v, minlength=out.size)
    cnt = np.bincount(flat, minlength=out.size)
    m = cnt > 0
    o = out.ravel()
    o[m] = tot[m] / cnt[m]
    out = o.reshape(out.shape)
    out = _close_pinholes(out)
    return 10 ** out if log_space else out


def _close_pinholes(a: np.ndarray) -> np.ndarray:
    """Fill single empty cells between pixels (satellite pixel spacing), never across real cloud gaps."""
    p = np.pad(a, 1, constant_values=np.nan)
    nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:], p[:-2, :-2], p[:-2, 2:], p[2:, :-2], p[2:, 2:]])
    have = np.isfinite(nb).sum(0)
    import warnings
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        mean = np.nanmean(nb, axis=0)
    fill = ~np.isfinite(a) & (have >= 5)
    out = a.copy()
    out[fill] = mean[fill]
    return out


def regrid(src: Grid, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    return np.asarray(src.sample(la, lo), dtype=np.float64)


# ------------------------------------------------------------------ the composite
def pass_grid(store, layer: str, region: str, bbox: tuple, g: dict, auth, log=log_default) -> Grid | None:
    """One pass on our grid. Cached, so each pass is downloaded only once."""
    key = f"passes/{layer}/{region}/{re.sub(r'[^A-Za-z0-9._-]', '_', g['id'])}.npz"
    raw = store.get(key)
    if raw:
        return Grid.from_bytes(raw)
    lats, lons = target_grid(bbox)
    content = download(auth, g["url"])
    got = read_pass(content, "chl" if layer == "chl" else "sst", bbox)
    vals = regrid(got, lats, lons) if isinstance(got, Grid) else bin_pixels(lats, lons, *got, log_space=(layer == "chl"))
    out = Grid(lats, lons, vals.astype(np.float32), {"observed_at": g["at"], "sat": g["sat"], "collection": g["collection"]})
    store.put(key, out.to_bytes())
    return out


def composite(layer: str, region: str, bbox: tuple, http, auth, store, now: datetime | None = None, log=log_default) -> Grid | None:
    """Newest-wins stack of today's passes. meta: observed_at (newest pass), passes [{sat, at, seen}], fresh_share."""
    now = now or datetime.now(timezone.utc)
    lats, lons = target_grid(bbox)
    stacks = []
    for group in ([layer] + (["sst_fill"] if layer == "sst" else [])):
        grans = []
        colls = find_collections(http, COLLECTIONS[group], log)
        for c in colls:
            grans += find_granules(http, c, bbox, now - timedelta(hours=HOURS[group]), now, log)
        log(f"passes {group}: NASA catalog has {', '.join(c['short_name'] for c in colls) or 'nothing matching ' + str(COLLECTIONS[group])}; "
            f"{len(grans)} passes over SoCal in the last {HOURS[group]} h")
        if group == "sst_fill":
            grans = sorted(grans, key=lambda g: g["at"])[-6:]      # the last few hourly GOES pictures are enough
        grids = []
        for g in sorted(grans, key=lambda g: g["at"]):
            try:
                pg = pass_grid(store, layer, region, bbox, g, auth, log)
            except PermissionError:
                raise
            except Exception as ex:
                log(f"passes: {g['sat']} {g['at']}: skipped ({type(ex).__name__}: {str(ex)[:120]})")
                continue
            if np.isfinite(pg.values).any():        # the pass saw at least some clear water in the box
                grids.append(pg)
        stacks.append((group, grids))
    main = stacks[0][1]
    if not main:
        return None
    vals = np.full((lats.size, lons.size), np.nan)
    passes = []
    for pg in main:                                       # oldest → newest: newest wins
        v = np.asarray(pg.values, dtype=np.float64)
        vals = np.where(np.isfinite(v), v, vals)
        passes.append({"sat": pg.meta.get("sat"), "at": pg.meta.get("observed_at"), "seen": round(float(np.isfinite(v).mean()), 3)})
    fresh = np.isfinite(vals)
    if len(stacks) > 1 and stacks[1][1]:                  # GOES-West fills what VIIRS couldn't see
        fill = np.full_like(vals, np.nan)
        for pg in stacks[1][1]:
            v = np.asarray(pg.values, dtype=np.float64)
            fill = np.where(np.isfinite(v), v, fill)
        vals = np.where(np.isfinite(vals), vals, fill)
        passes += [{"sat": "GOES-West", "at": stacks[1][1][-1].meta.get("observed_at"), "seen": round(float(np.isfinite(fill).mean()), 3), "fill": True}]
    newest = max(p["at"] for p in passes if not p.get("fill"))
    return Grid(lats, lons, vals.astype(np.float32), {
        "observed_at": newest, "passes": passes[-12:], "fresh_share": round(float(fresh.mean()), 3),
        "today_share": round(float(np.isfinite(vals).mean()), 3)})


def mode() -> str:
    return "on" if os.environ.get("PASSES", "").strip().lower() == "on" else "preview"


# ------------------------------------------------------------------ no blank clouds (Nov 6)
def blend(today: Grid, older: Grid | None, log_space: bool = False, sigma_km: float = 15.0) -> Grid:
    """Today's passes with every cloud hole filled so it blends in (no blank patches, no visible seams):
      1. Under clouds, use the older daily map, but shifted to match today: the difference between today and the
         older map along the edges of each cloud is spread smoothly into the cloud (so a cloud over warmer-today
         water is filled warmer, and the patch doesn't show a step at its edge).
      2. Anything still empty (no older map there either) is filled smoothly from the water around it.
    Chlorophyll is blended on a log scale (how it's colored)."""
    from scipy.ndimage import distance_transform_edt, gaussian_filter
    tr = (lambda a: np.log10(np.clip(a, 1e-4, None))) if log_space else (lambda a: a)
    un = (lambda a: 10 ** a) if log_space else (lambda a: a)
    t = tr(np.asarray(today.values, dtype=np.float64))
    have = np.isfinite(t)
    out = t.copy()
    res_km = 111.0 * float(today.lats[1] - today.lats[0])
    sig = max(1.0, sigma_km / max(res_km, 0.1))
    if older is not None:
        la, lo = np.meshgrid(today.lats, today.lons, indexing="ij")
        o = tr(np.asarray(older.sample(la, lo), dtype=np.float64))
        both = have & np.isfinite(o)
        if both.any():
            diff = np.where(both, t - o, 0.0)
            num = gaussian_filter(diff, sig * 2, mode="nearest")
            den = gaussian_filter(both.astype(float), sig * 2, mode="nearest")
            offset = np.where(den > 1e-3, num / np.maximum(den, 1e-12), 0.0)
            # far from any of today's data, trust the older map as it is
            near = gaussian_filter(both.astype(float), sig * 4, mode="nearest")
            offset *= np.clip(near / max(near.max(), 1e-12) * 4, 0, 1)
            fill = ~have & np.isfinite(o)
            out[fill] = o[fill] + offset[fill]
        else:
            fill = ~have & np.isfinite(o)
            out[fill] = o[fill]
    # still empty: fill from the nearest water, then soften so it doesn't look blocky
    hole = ~np.isfinite(out)
    if hole.any() and (~hole).any():
        idx = distance_transform_edt(hole, return_distances=False, return_indices=True)
        near = out[tuple(idx)]
        soft = gaussian_filter(near, sig, mode="nearest")
        out[hole] = soft[hole]
    # feather the seam: right at the edge of today's data, ease from today's values into the filled values
    filled = ~have & np.isfinite(out)
    if filled.any() and have.any():
        dist = distance_transform_edt(~have) * res_km                 # km from today's nearest clear pixel
        w = np.clip(dist / 6.0, 0, 1)                                 # 0 at the edge → 1 at 6 km inside the cloud
        smooth = gaussian_filter(np.where(np.isfinite(out), out, 0), 1.5, mode="nearest")
        out[filled] = (1 - w[filled]) * smooth[filled] + w[filled] * out[filled]
    meta = dict(today.meta)
    meta["blended"] = True
    return Grid(today.lats, today.lons, un(out).astype(np.float32), meta)
