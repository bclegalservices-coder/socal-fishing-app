"""Satellite / gridded dataset registry (master spec §10, §49, §63).

Dataset IDs change over time, so every value here can be overridden with an
environment variable, and `python -m ocean.jobs discover` lists current candidates.
Entries marked verified=False MUST be checked against the live ERDDAP before launch.
"""
import os
from dataclasses import dataclass, field

# SoCal + North Baja working box (lon_min, lat_min, lon_max, lat_max). Regions are data, not code.
REGIONS = {
    "socal": (-121.0, 31.0, -116.6, 35.0),
}


@dataclass(frozen=True)
class GridDataset:
    key: str
    label: str
    erddap: str
    dataset_id: str
    variable: str
    dims: tuple[str, ...]          # order of dimensions in the griddap query
    units: str                     # units the server returns
    kind: str                      # observed | interpolated | static
    resolution_m: float
    source: str
    verified: bool = False
    fixed: dict = field(default_factory=dict)   # constant values for extra dims, e.g. {"altitude": 0.0}
    docs: str = ""


def _env(name: str, default: str) -> str:
    # GitHub passes unset repository variables as empty strings, so treat blank the same as missing.
    return os.environ.get(name) or default


PFEG = "https://coastwatch.pfeg.noaa.gov/erddap"

DATASETS: dict[str, GridDataset] = {
    # Gap-filled (interpolated) SST. Always labeled "satellite blend, fills clouds".
    "sst": GridDataset(
        key="sst", label="Sea surface temperature",
        erddap=_env("SST_ERDDAP", PFEG), dataset_id=_env("SST_DATASET", "jplMURSST41"),
        variable=_env("SST_VARIABLE", "analysed_sst"), dims=("time", "latitude", "longitude"),
        units="degC", kind="interpolated", resolution_m=1000, source="NASA JPL MUR via NOAA CoastWatch ERDDAP",
        docs="https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html",
    ),
    # Chlorophyll-a, VIIRS. Observed (gaps where clouds). VERIFY the ID with `discover`.
    "chl": GridDataset(
        key="chl", label="Chlorophyll-a",
        erddap=_env("CHL_ERDDAP", PFEG), dataset_id=_env("CHL_DATASET", "nesdisVHNnoaa20chlaDaily"),
        variable=_env("CHL_VARIABLE", "chlor_a"), dims=("time", "altitude", "latitude", "longitude"),
        units="mg m-3", kind="observed", resolution_m=750, source="NOAA VIIRS ocean color via CoastWatch ERDDAP",
        fixed={"altitude": 0.0},
    ),
    # Coarse global bathymetry baseline (~1.8 km). High-res SoCal relief model loads via `bathy --file`.
    "bathy": GridDataset(
        key="bathy", label="Seafloor depth",
        erddap=_env("BATHY_ERDDAP", PFEG), dataset_id=_env("BATHY_DATASET", "etopo180"),
        variable=_env("BATHY_VARIABLE", "altitude"), dims=("latitude", "longitude"),
        units="m", kind="static", resolution_m=1850, source="NOAA NCEI ETOPO via CoastWatch ERDDAP",
    ),
}

# Chlorophyll sources to try in order when the main one is down or retired (NOAA retires these often).
# Checked 2026-10-20 from a Mac: the first two had Oct 16 data but flickered on and off; erdVHNchla1day
# (VIIRS, US West Coast) answered both times. All four are on the pfeg server, which GitHub can reach.
CHL_FALLBACKS: list[str] = [
    "nesdisVHNchlaDaily",        # S-NPP VIIRS, near real-time, daily
    "nesdisVHNnoaa20chlaDaily",  # NOAA-20 VIIRS, near real-time, daily
    "erdVHNchla1day",            # VIIRS West Coast, daily
    "erdVHNchla8day",            # VIIRS West Coast, 8-day blend (fewer cloud gaps, older)
]

# Break thresholds (configurable, spec §12): change per NM of distance.
BREAKS = {
    # Nov 7: fewer, better lines — a line every 1 °F (was 0.5), only where the water changes ≥ 0.8 °F per mile
    # (strong ≥ 1.5), each line reaching at least 3 NM end to end, never on land, within ~0.6 NM of shore, or in filled-in clouds.
    # Nov 7 (later): the app has a "How many breaks" choice (Strongest / Strong / More / Most), so the server keeps
    # every line down to 0.6 × moderate, every 0.5 °F, each reaching ≥ 2 NM, and tags how strong and how long it is.
    "sst": {"moderate": float(_env("SST_BREAK_MODERATE_F_PER_NM", "0.8")), "strong": float(_env("SST_BREAK_STRONG_F_PER_NM", "1.5")),
            "interval": 0.5, "min_len_nm": 2.0, "coast_nm": 0.6, "ranked": True},
    # chlorophyll works on log10(mg/m3): 0.1 per NM ≈ 26% change per mile
    # (green-to-blue edges: kept exactly as they were — they looked right; only kept off land)
    "chl": {"moderate": float(_env("CHL_EDGE_MODERATE_LOG_PER_NM", "0.06")), "strong": float(_env("CHL_EDGE_STRONG_LOG_PER_NM", "0.12")),
            "interval": 0.1, "min_len_nm": 0.0, "coast_nm": 0.0},
}


def break_settings(layer: str, resolution_m: float | None) -> dict:
    """Break thresholds tuned to how sharp the map is. The numbers above are for ~1 km maps (NOAA MUR, VIIRS).
    A coarser map (e.g. Copernicus OSTIA, ~5 km) spreads the same front over more miles, so the change per mile
    looks smaller; scale the thresholds down (but never below 35%) and skip the extra smoothing, which a
    blended map doesn't need. Example: 5.5 km → 0.21 / 0.43 °F per NM ≈ a 1-2 °F change across 5 miles."""
    b = dict(BREAKS[layer])
    res = float(resolution_m or 1000)
    if res > 1500:
        f = max(0.35, min(1.0, (1000.0 / res) ** 0.5))
        b["moderate"] = round(b["moderate"] * f, 3)
        b["strong"] = round(b["strong"] * f, 3)
        b["sigma"] = 0.0
    else:
        b["sigma"] = 1.5 if layer == "sst" else 1.0   # Nov 7: a bit more smoothing for water-temp breaks at ~1 km
    return b

TILE_ZOOMS = {"sst": range(5, 11), "chl": range(5, 11), "bathy": range(5, 12)}

# Live layers served directly by public providers (tiles never pass through our server).
EXTERNAL_LAYERS = [
    {
        "key": "radar", "label": "Radar (precipitation)", "kind": "observed",
        "source": "NOAA NEXRAD via Iowa Environmental Mesonet",
        "tiles": "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
        "frames": [f"https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913-m{m:02d}m/{{z}}/{{x}}/{{y}}.png" for m in range(50, 0, -5)],
        "frame_minutes_ago": list(range(50, 0, -5)),
        "refresh_seconds": 300, "verified": False,
        "note": "Verify terms of use for commercial apps before launch; NOAA nowCOAST is the fallback.",
    },
]
