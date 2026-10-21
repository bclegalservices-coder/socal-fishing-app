"""Wind forecast layer: NOAA GFS 0.25° 10 m wind (and gusts), next 48 h every 3 h, from NOMADS.
Drawn on the map as arrows colored by speed and labeled 'forecast · model run HHZ'.
Uses ecCodes to read GRIB2 (pip install -r requirements-pipeline.txt).

Upgrade path: HRRR (3 km) near shore once grid-relative winds are rotated to true north.
"""
import io
import json
import math
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
HOURS = list(range(0, 49, 3))


def arrows(lats: np.ndarray, lons: np.ndarray, u: np.ndarray, v: np.ndarray, gust: np.ndarray | None = None,
           length_deg: float = 0.1) -> dict:
    """One small arrow per grid point, pointing the way the wind BLOWS TOWARD.
    Properties carry speed (kt), direction it comes FROM (°T, as sailors say it) and gust."""
    feats = []
    for i, la in enumerate(lats):
        k = 1 / max(0.2, math.cos(math.radians(la)))
        for j, lo in enumerate(lons):
            uu, vv = float(u[i, j]), float(v[i, j])
            if not (math.isfinite(uu) and math.isfinite(vv)):
                continue
            spd_ms = math.hypot(uu, vv)
            kt = spd_ms * 1.943844
            frm = (270.0 - math.degrees(math.atan2(vv, uu))) % 360.0
            if spd_ms < 0.05:
                continue
            dx, dy = uu / spd_ms, vv / spd_ms              # unit vector toward
            L = length_deg * (0.6 + min(kt, 30) / 30 * 0.8)  # longer arrow = stronger wind
            tip = (lo + dx * L * k, la + dy * L)
            tail = (lo - dx * L * k * 0.5, la - dy * L * 0.5)
            # arrow head: two short barbs angled back from the tip
            hl = L * 0.35
            ang = math.atan2(dy, dx)
            h1 = (tip[0] - math.cos(ang - 0.5) * hl * k, tip[1] - math.sin(ang - 0.5) * hl)
            h2 = (tip[0] - math.cos(ang + 0.5) * hl * k, tip[1] - math.sin(ang + 0.5) * hl)
            r = lambda p: [round(p[0], 4), round(p[1], 4)]  # noqa: E731
            feats.append({
                "type": "Feature",
                "geometry": {"type": "MultiLineString", "coordinates": [[r(tail), r(tip)], [r(h1), r(tip), r(h2)]]},
                "properties": {"kt": round(kt, 1), "from": round(frm),
                               "gust": None if gust is None or not math.isfinite(float(gust[i, j])) else round(float(gust[i, j]) * 1.943844, 1)},
            })
    return {"type": "FeatureCollection", "features": feats}


# WindAlert-style speed colors, in knots: calm blue → green → yellow → orange → red → magenta.
WIND_KT = {"min": 0.0, "max": 35.0, "stops": ["#4b5fc4", "#3a8fd6", "#33bfc0", "#5ccf6e", "#c8d84a", "#f2c43a",
                                               "#f5902a", "#e2532f", "#c0303f", "#9b2f8f"]}
TILE_ZOOMS = range(5, 10)   # ~90 small squares per hour; the map smooths them when zoomed further


def speed_tiles(store, lats, lons, u, v, base: str, bbox: tuple) -> int:
    """Colored wind-speed map squares for one forecast hour."""
    from .colormaps import apply
    from .grid import Grid
    from .tiles import render, tiles_for_bbox
    kt = (np.hypot(u, v) * 1.943844).astype(np.float32)
    g = Grid(np.asarray(lats, dtype=np.float64), np.asarray(lons, dtype=np.float64), kt, {"units": "kt"})
    n = 0
    for z in TILE_ZOOMS:
        for zz, x, y in tiles_for_bbox(bbox, z):
            png = render(g, zz, x, y, lambda val: apply(val, WIND_KT, 255))
            if png:
                store.put(f"{base}/{zz}/{x}/{y}.png", png, "image/png")
                n += 1
    return n


def uv_grid(lats, lons, u, v) -> dict:
    """Small wind grid (m/s) the app uses to move the wind streaks."""
    r = lambda a: [[None if not math.isfinite(float(x)) else round(float(x), 1) for x in row] for row in a]  # noqa: E731
    return {"lats": [round(float(x), 4) for x in lats], "lons": [round(float(x), 4) for x in lons], "u": r(u), "v": r(v)}


def _filter_url(run: datetime, fh: int, bbox: tuple) -> str:
    lon_min, lat_min, lon_max, lat_max = bbox
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    return (f"{FILTER}?dir=%2Fgfs.{d}%2F{h}%2Fatmos&file=gfs.t{h}z.pgrb2.0p25.f{fh:03d}"
            "&var_UGRD=on&var_VGRD=on&var_GUST=on&lev_10_m_above_ground=on&lev_surface=on"
            f"&subregion=&toplat={lat_max + 0.5}&leftlon={(lon_min - 0.5) % 360}&rightlon={(lon_max + 0.5) % 360}&bottomlat={lat_min - 0.5}")


def latest_run(http: httpx.Client, bbox: tuple, now: datetime | None = None) -> datetime:
    """Newest GFS cycle whose 48-h file is already posted."""
    now = now or datetime.now(timezone.utc)
    t = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for _ in range(6):
        r = http.get(_filter_url(t, 48, bbox))
        if r.status_code == 200 and len(r.content) > 100:
            return t
        t -= timedelta(hours=6)
    raise RuntimeError("No complete GFS run found on NOMADS in the last 36 hours")


def decode(grib: bytes) -> tuple[np.ndarray, np.ndarray, dict]:
    import eccodes  # pipeline-only dependency
    fields, lats, lons = {}, None, None
    import os
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
        tmp.write(grib)
        path = tmp.name
    try:
        with open(path, "rb") as fh:
            while True:
                gid = eccodes.codes_grib_new_from_file(fh)
                if gid is None:
                    break
                try:
                    name = eccodes.codes_get(gid, "shortName")
                    ni, nj = eccodes.codes_get(gid, "Ni"), eccodes.codes_get(gid, "Nj")
                    vals = eccodes.codes_get_values(gid).reshape(nj, ni)
                    if lats is None:
                        la = eccodes.codes_get_array(gid, "latitudes").reshape(nj, ni)[:, 0]
                        lo = eccodes.codes_get_array(gid, "longitudes").reshape(nj, ni)[0, :]
                        lats, lons = la, np.where(lo > 180, lo - 360, lo)
                    fields[name] = vals
                finally:
                    eccodes.codes_release(gid)
    finally:
        os.unlink(path)
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        fields = {k: v[::-1, :] for k, v in fields.items()}
    return lats, lons, fields


def _gfs_hour(http, cycle, fh, bbox):
    r = http.get(_filter_url(cycle, fh, bbox))
    r.raise_for_status()
    lats, lons, f = decode(r.content)
    return lats, lons, f["10u"], f["10v"], f.get("gust")


def _thin(lats, lons, u, v, gust, every: int):
    """Every Nth point for the arrow layer (3 km HRRR would be ~20,000 arrows)."""
    if every <= 1:
        return lats, lons, u, v, gust
    sl = (slice(None, None, every), slice(None, None, every))
    return lats[::every], lons[::every], u[sl], v[sl], None if gust is None else gust[sl]


def run(store, bbox: tuple, region: str = "socal") -> dict:
    """Next 18 h from HRRR (3 km, hourly), then GFS (25 km, every 3 h) out to 48 h. Falls back to GFS only."""
    from . import hrrr
    http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
    plan = []   # (valid_time, source, run, fh)
    try:
        hr = hrrr.latest_run(http, bbox)
        plan += [(hr + timedelta(hours=fh), "hrrr", hr, fh) for fh in range(0, 19)]
    except Exception as e:
        print(f"wind: HRRR unavailable ({str(e)[:150]}), using GFS for all hours")
    cycle = latest_run(http, bbox)
    last = plan[-1][0] if plan else None
    plan += [(cycle + timedelta(hours=fh), "gfs", cycle, fh) for fh in HOURS
             if last is None or cycle + timedelta(hours=fh) > last]
    now = datetime.now(timezone.utc)
    plan = [p for p in plan if p[0] >= now - timedelta(hours=1)][:30]
    tag = (plan[0][2] if plan else cycle).strftime("%Y%m%d%H")
    hours = []
    for i, (valid, src, run_t, fh) in enumerate(plan):
        try:
            lats, lons, u, v, gust = (hrrr.hour_fields(http, run_t, fh, bbox) if src == "hrrr" else _gfs_hour(http, run_t, fh, bbox))
        except Exception as e:
            print(f"wind: {src} f{fh:02d} skipped ({str(e)[:120]})")
            continue
        fc = arrows(*_thin(lats, lons, u, v, gust, 4 if src == "hrrr" else 1))
        key = f"vectors/wind/{region}/{tag}/h{i:03d}.geojson"
        store.put(key, json.dumps(fc).encode(), "application/geo+json")
        tbase = f"tiles/wind/{region}/{tag}/h{i:03d}"
        n = speed_tiles(store, lats, lons, u, v, tbase, bbox)
        uvk = f"vectors/wind/{region}/{tag}/h{i:03d}.uv.json"
        store.put(uvk, json.dumps(uv_grid(lats, lons, u, v), separators=(",", ":")).encode(), "application/json")
        hours.append({"fh": i, "valid": valid.isoformat(), "url": store.url(key), "model": "HRRR 3 km" if src == "hrrr" else "GFS 25 km",
                      "tiles": store.url(tbase) + "/{z}/{x}/{y}.png" if n else None, "uv": store.url(uvk)})
    if not hours:
        raise RuntimeError("No wind hours could be processed")
    sources = sorted({h["model"] for h in hours})
    manifest = {
        "layer": "wind", "label": "Wind forecast", "kind": "forecast",
        "source": "NOAA " + " + ".join(sources) + " via NOMADS", "resolution_m": 3000 if any("HRRR" in x for x in sources) else 25000,
        "note": "Model forecast, not measured. Color = wind speed; streaks and arrows move the way the wind blows. See buoys for measured wind.",
        "run": plan[0][2].isoformat(), "hours": hours,
        "legend": {"unit": "kt", "stops": WIND_KT["stops"], "ticks": [0, 5, 10, 15, 20, 25, 30, 35], "min": 0, "max": 35},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    old = store.get("manifests/wind.json")
    store.put("manifests/wind.json", json.dumps(manifest).encode(), "application/json")
    # Keep the newest run and the one before it (phones may still be showing it); delete older runs to save space.
    try:
        prev = json.loads(old).get("run", "") if old else ""
        keep = {tag, datetime.fromisoformat(prev).strftime("%Y%m%d%H") if prev else tag}
        for k in json.loads(old or "{}").get("older_runs", []):
            if k not in keep and hasattr(store, "delete_prefix"):
                store.delete_prefix(f"tiles/wind/{region}/{k}/")
                store.delete_prefix(f"vectors/wind/{region}/{k}/")
        manifest["older_runs"] = sorted(keep - {tag})
        store.put("manifests/wind.json", json.dumps(manifest).encode(), "application/json")
    except Exception as e:
        print(f"wind: cleanup skipped ({e})")
    return manifest
