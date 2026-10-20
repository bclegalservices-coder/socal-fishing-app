"""Web-Mercator XYZ tiles rendered from a Grid (spec §33, §47). Generated once per
day per region on the server; phones only download the PNGs they look at."""
import io
import math

import numpy as np
from PIL import Image

from .grid import Grid

TILE = 256


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(max(min(lat, 85.0511), -85.0511))
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) in degrees."""
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def tiles_for_bbox(bbox: tuple, z: int):
    lon_min, lat_min, lon_max, lat_max = bbox
    x0, y0 = lonlat_to_tile(lon_min, lat_max, z)
    x1, y1 = lonlat_to_tile(lon_max, lat_min, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield z, x, y


def pixel_lonlat(z: int, x: int, y: int):
    """Lon/lat of every pixel center in a tile (256x256 arrays)."""
    n = 2 ** z
    px = (np.arange(TILE) + 0.5) / TILE
    gx = (x + px) / n
    gy = (y + px) / n
    lon = gx * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * gy))))
    return np.meshgrid(lon, lat)


def render(g: Grid, z: int, x: int, y: int, colorize, values_fn=None) -> bytes | None:
    """PNG bytes, or None when the tile has no data (so we don't store empty files)."""
    lon, lat = pixel_lonlat(z, x, y)
    v = g.sample(lat, lon)
    if values_fn is not None:
        v = values_fn(v, lat, lon)
    if not np.isfinite(v).any():
        return None
    rgba = colorize(v)
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()
