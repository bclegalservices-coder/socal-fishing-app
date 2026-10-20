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


def run(store, bbox: tuple, region: str = "socal") -> dict:
    http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
    cycle = latest_run(http, bbox)
    tag = cycle.strftime("%Y%m%d%H")
    hours = []
    for fh in HOURS:
        r = http.get(_filter_url(cycle, fh, bbox))
        r.raise_for_status()
        lats, lons, f = decode(r.content)
        fc = arrows(lats, lons, f["10u"], f["10v"], f.get("gust"))
        key = f"vectors/wind/{region}/{tag}/f{fh:03d}.geojson"
        store.put(key, json.dumps(fc).encode(), "application/geo+json")
        hours.append({"fh": fh, "valid": (cycle + timedelta(hours=fh)).isoformat(), "url": store.url(key)})
    manifest = {
        "layer": "wind", "label": "Wind forecast", "kind": "forecast",
        "source": "NOAA GFS 0.25° via NOMADS", "resolution_m": 25000,
        "note": "Model forecast, not measured. Arrows point the way the wind blows; color = speed. See buoys for measured wind.",
        "run": cycle.isoformat(), "hours": hours,
        "legend": {"unit": "kt", "stops": ["#7fd0e8", "#62cbe2", "#f2d36a", "#f5a524", "#e7663a", "#c43a3a"], "ticks": [0, 5, 10, 15, 20, 25, 30], "min": 0, "max": 30},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    store.put("manifests/wind.json", json.dumps(manifest).encode(), "application/json")
    return manifest
