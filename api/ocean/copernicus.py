"""E.U. Copernicus Marine Service: daily gap-free chlorophyll (Copernicus-GlobColour, multi-satellite, 4 km).

Clouds are filled in by the provider (space-time interpolation), so there is a complete map every day.
Login comes from the environment: COPERNICUSMARINE_SERVICE_USERNAME / COPERNICUSMARINE_SERVICE_PASSWORD
(GitHub repository secrets). Tested 2026-10-20: one day old, 89% coverage around Catalina (the rest is land).
Required credit wherever the layer is shown: "Generated using E.U. Copernicus Marine Service Information".
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import numpy as np

from .grid import Grid

CHL_DATASET = os.environ.get("COP_CHL_DATASET") or "cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D"
# Water-temperature backup: UK Met Office OSTIA, daily, gap-free, ~5 km (coarser than NOAA's 1 km MUR).
SST_DATASET = os.environ.get("COP_SST_DATASET") or "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2"
SST_SOURCE = "E.U. Copernicus Marine Service (UK Met Office OSTIA, clouds filled in)"
CREDIT = "Generated using E.U. Copernicus Marine Service Information"
SOURCE = "E.U. Copernicus Marine Service (GlobColour, multi-satellite, clouds filled in)"


def enabled() -> bool:
    return bool(os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") and os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD"))


def fetch_chl(bbox: tuple, when="last") -> Grid:
    return fetch(CHL_DATASET, "CHL", "chl", "mg m-3", SOURCE, 4000, bbox, when)


def fetch_sst(bbox: tuple, when="last") -> Grid:
    return fetch(SST_DATASET, "analysed_sst", "sst", "K", SST_SOURCE, 5500, bbox, when)


def fetch(dataset: str, variable: str, layer: str, units: str, source: str, res_m: float, bbox: tuple, when="last") -> Grid:
    import copernicusmarine as cm  # only needed by the daily job

    lon_min, lat_min, lon_max, lat_max = bbox
    if when in (None, "last"):
        start = datetime.now(timezone.utc) - timedelta(days=8)
        end = None
    else:
        day = when if isinstance(when, date) else date.fromisoformat(str(when)[:10])
        start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        end = start + timedelta(hours=23, minutes=59)
    kw = dict(dataset_id=dataset, variables=[variable], minimum_longitude=lon_min, maximum_longitude=lon_max,
              minimum_latitude=lat_min, maximum_latitude=lat_max, start_datetime=start.strftime("%Y-%m-%dT%H:%M:%S"))
    if end:
        kw["end_datetime"] = end.strftime("%Y-%m-%dT%H:%M:%S")
    ds = cm.open_dataset(**kw)
    da = ds[variable]
    if "time" in da.dims:
        if da.sizes["time"] == 0:
            raise RuntimeError(f"Copernicus has no {layer} for {when}")
        da = da.isel(time=-1)
    t = str(da["time"].values)[:19] + "+00:00" if "time" in da.coords else None
    if "depth" in da.dims:
        da = da.isel(depth=0)
    vals = np.asarray(da.transpose("latitude", "longitude").values, dtype=np.float32)
    vals = np.where(np.isfinite(vals) & (vals > 0), vals, np.nan).astype(np.float32)
    return Grid(np.asarray(da["latitude"].values, dtype=np.float64), np.asarray(da["longitude"].values, dtype=np.float64), vals, {
        "layer": layer, "dataset": dataset, "source": source, "credit": CREDIT, "units": units,
        "kind": "interpolated", "resolution_m": res_m, "verified": True, "observed_at": t,
    })
