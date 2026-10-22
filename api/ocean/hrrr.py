"""NOAA HRRR (High-Resolution Rapid Refresh): 3 km wind, new run every hour, 18 h ahead (48 h at 00/06/12/18 UTC).
Sees what the 25 km GFS can't: the Catalina eddy, the calm in an island's lee, afternoon sea breeze lines.

HRRR is on a Lambert conformal grid and its winds are relative to that grid, so each u/v is rotated to true
north, then everything is resampled onto a regular lat/lon grid (about 3 km) that the tiles and the app use.
Source: NOMADS grib filter (free, public). Needs ecCodes (pipeline requirements).
"""
from __future__ import annotations

import math
import os
import tempfile
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl"
LOV = -97.5          # HRRR grid orientation longitude
LATIN = 38.5         # HRRR standard parallel
STEP_DEG = 0.03      # regular output grid, ~3 km


def url(run: datetime, fh: int, bbox: tuple) -> str:
    lon_min, lat_min, lon_max, lat_max = bbox
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    return (f"{FILTER}?dir=%2Fhrrr.{d}%2Fconus&file=hrrr.t{h}z.wrfsfcf{fh:02d}.grib2"
            "&var_UGRD=on&var_VGRD=on&var_GUST=on&var_REFC=on&lev_10_m_above_ground=on&lev_surface=on&lev_entire_atmosphere=on"
            f"&subregion=&toplat={lat_max + 0.3}&leftlon={lon_min - 0.3}&rightlon={lon_max + 0.3}&bottomlat={lat_min - 0.3}")


def latest_run(http: httpx.Client, bbox: tuple, want_hours: int = 18, now: datetime | None = None) -> datetime:
    """Newest HRRR run whose last needed forecast hour is already posted."""
    now = (now or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0)
    for back in range(1, 8):
        t = now - timedelta(hours=back)
        r = http.get(url(t, want_hours, bbox))
        if r.status_code == 200 and len(r.content) > 100:
            return t
    raise RuntimeError("No complete HRRR run found on NOMADS in the last 7 hours")


def rotate_to_earth(u: np.ndarray, v: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Grid-relative (Lambert conformal) winds → true north / east components."""
    a = math.sin(math.radians(LATIN)) * np.radians(lon - LOV)
    ca, sa = np.cos(a), np.sin(a)
    return ca * u + sa * v, -sa * u + ca * v


def regrid(lat2: np.ndarray, lon2: np.ndarray, fields: dict, bbox: tuple, step: float = STEP_DEG) -> tuple[np.ndarray, np.ndarray, dict]:
    """Nearest-neighbour resample of curvilinear HRRR fields onto a regular lat/lon grid (NaN where too far)."""
    from scipy.spatial import cKDTree
    lon_min, lat_min, lon_max, lat_max = bbox
    lats = np.round(np.arange(lat_min, lat_max + step / 2, step), 4)
    lons = np.round(np.arange(lon_min, lon_max + step / 2, step), 4)
    k = math.cos(math.radians((lat_min + lat_max) / 2))
    tree = cKDTree(np.column_stack([lon2.ravel() * k, lat2.ravel()]))
    glon, glat = np.meshgrid(lons, lats)
    dist, idx = tree.query(np.column_stack([glon.ravel() * k, glat.ravel()]))
    far = dist > step * 1.6
    out = {}
    for name, val in fields.items():
        a = val.ravel()[idx].astype(np.float32)
        a[far] = np.nan
        out[name] = a.reshape(glat.shape)
    return lats, lons, out


def decode(grib: bytes) -> tuple[np.ndarray, np.ndarray, dict, bool]:
    """(2-D lats, 2-D lons, {shortName: values}, winds_are_grid_relative)."""
    import eccodes
    fields, lat2, lon2, grid_rel = {}, None, None, False
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
                    fields[name] = eccodes.codes_get_values(gid).reshape(nj, ni)
                    if lat2 is None:
                        lat2 = eccodes.codes_get_array(gid, "latitudes").reshape(nj, ni)
                        lo = eccodes.codes_get_array(gid, "longitudes").reshape(nj, ni)
                        lon2 = np.where(lo > 180, lo - 360, lo)
                    try:
                        grid_rel = grid_rel or bool(eccodes.codes_get(gid, "uvRelativeToGrid"))
                    except Exception:
                        grid_rel = True   # HRRR winds are grid-relative
                finally:
                    eccodes.codes_release(gid)
    finally:
        os.unlink(path)
    return lat2, lon2, fields, grid_rel


def hour_fields(http: httpx.Client, run: datetime, fh: int, bbox: tuple, with_radar: bool = False):
    """Regular-grid (lats, lons, u, v, gust) in m/s, true north, for one HRRR forecast hour.
    with_radar=True adds a 6th value: forecast composite reflectivity (dBZ), i.e. what the radar should show."""
    r = http.get(url(run, fh, bbox))
    r.raise_for_status()
    lat2, lon2, f, grid_rel = decode(r.content)
    u, v = f["10u"], f["10v"]
    if grid_rel:
        u, v = rotate_to_earth(u, v, lon2)
    extra = {"gust": f["gust"]} if "gust" in f else {}
    if with_radar and "refc" in f:
        extra["refc"] = f["refc"]
    lats, lons, g = regrid(lat2, lon2, {"u": u, "v": v, **extra}, bbox)
    if with_radar:
        return lats, lons, g["u"], g["v"], g.get("gust"), g.get("refc")
    return lats, lons, g["u"], g["v"], g.get("gust")
