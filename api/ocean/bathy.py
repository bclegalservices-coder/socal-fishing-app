"""Seafloor layer (spec §3/§4): depth tint + hillshade relief + slope-based structure,
contours in feet, and a depth lookup for tap-anywhere and catch snapshots.
Always labeled 'seafloor info, not a navigation chart'."""
import numpy as np

from .colormaps import DEPTH_FT, apply
from .contours import segments, to_multiline
from .grid import Grid

CONTOURS_FT = [60, 120, 180, 300, 600, 1200, 2400, 4800]


def slope_and_hillshade(depth_ft: Grid, azimuth=315.0, altitude=45.0, z_factor=3.0):
    """Slope in degrees and a 0..1 hillshade, from a depth grid in feet (positive down)."""
    elev = -np.nan_to_num(depth_ft.values.astype(np.float64), nan=0.0) * 0.3048  # meters, up positive
    dy = depth_ft.dlat * 111_320.0
    dx = depth_ft.dlon * 111_320.0 * np.cos(np.radians(depth_ft.lats))[:, None]
    gy = np.gradient(elev, axis=0) / dy * z_factor
    gx = np.gradient(elev, axis=1) / dx * z_factor
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(360.0 - azimuth + 90.0), np.radians(altitude)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    hs = np.clip(hs, 0, 1)
    hs[np.isnan(depth_ft.values)] = np.nan
    return np.degrees(slope / z_factor), hs


def shaded_grid(depth_ft: Grid) -> tuple[Grid, Grid, Grid]:
    slope, hs = slope_and_hillshade(depth_ft)
    return depth_ft, Grid(depth_ft.lats, depth_ft.lons, hs.astype(np.float32), {"layer": "hillshade"}), \
        Grid(depth_ft.lats, depth_ft.lons, slope.astype(np.float32), {"layer": "slope"})


def colorize_relief(depth_vals: np.ndarray, hs_vals: np.ndarray, slope_vals: np.ndarray, dropoff_deg: float = 6.0) -> np.ndarray:
    """Blue depth shading with soft relief light. (Oct 24: the amber "structure" tint on steep ground is gone — on the
    Catalina and Santa Barbara slopes it turned whole areas of deep water tan, so it read as land. Drop-offs now show
    as a gentle shadow instead.)"""
    rgba = apply(depth_vals, DEPTH_FT, alpha=255).astype(np.float64)
    shade = 0.78 + 0.32 * np.nan_to_num(hs_vals, nan=0.6)
    steep = np.clip((np.nan_to_num(slope_vals, nan=0) - 2.0) / 14.0, 0, 1)     # walls a touch darker, no color change
    rgba[..., :3] = np.clip(rgba[..., :3] * (shade * (1 - 0.12 * steep))[..., None], 0, 255)
    return rgba.astype(np.uint8)


def contour_geojson(depth_ft: Grid, levels=CONTOURS_FT) -> dict:
    feats = []
    for lv in levels:
        segs = [(p, q) for p, q, _, _ in segments(depth_ft.lats, depth_ft.lons, depth_ft.values.astype(np.float64), lv)]
        if segs:
            feats.append({"type": "Feature", "geometry": {"type": "MultiLineString", "coordinates": to_multiline(segs)},
                          "properties": {"depth_ft": lv, "label": f"{lv} ft"}})
    return {"type": "FeatureCollection", "features": feats}
