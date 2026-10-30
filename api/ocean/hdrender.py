"""HD bottom drawing, v5 (Oct 29) + v6 deep-water smoothing (Oct 30, see DEEP_*): a clean, smooth seafloor instead of a quilt of little boxes.

Why the old squares looked like boxes: NOAA's surveys are grids of 4–16 m cells. We stretched them onto ~1–2 m map
pixels with straight-line (bilinear) blending, which makes every cell a tiny flat tilted plate. The relief shading
lights each plate differently — so you saw the survey grid as a waffle of boxes, and ledges as staircases. On top of
that, where a fine survey met a coarser one the depths jumped, and the shading drew a fake cliff along the seam.

How v5 draws a square:
  1. Depths are read at full Retina size (512 px per square) with a margin of MARGIN px all around, so smoothing and
     shading run straight across square edges (no seams between squares).
  2. Where two surveys meet they're feathered together over a band instead of switched (no fake cliffs).
  3. Each pixel is smoothed by its own survey's cell size (sigma ≈ 0.8 cell): the grid and survey noise disappear,
     real reefs, ledges and channels (several cells wide) stay. A fine survey keeps its fine detail.
  4. Relief shading from that smooth surface with Horn's 3×3 slope (the standard GIS method), lit from several
     directions, soft ambient so nothing goes black, and the height exaggeration eased off when zoomed in.
  5. Depth colors from the same smooth surface, and the chart-style contour lines (contourdraw.py) on top.
"""
from __future__ import annotations

import math

import numpy as np

READ = 512                 # image px per map square (Retina)
MARGIN = 72                # extra px read around every square (v6: 72, so the deep-water smoothing joins across squares)
EARTH = 40075016.685578488
M_TO_FT = 3.28084
CELLS = 0.8                # smoothing per survey cell (sigma, in cells) for colors and contour lines
SHADE_CELLS = 1.4          # ... for the relief shading
LINE_CELLS = 1.6           # ... and for tracing contour lines (flat bottoms: noise would make lines wiggle)
# v6 (Oct 30): deep water. Out past the reefs NOAA often has no real survey, only scattered soundings joined by
# straight triangles — shaded, those show up as big sharp "crystal" facets. So the smoothing also grows with depth
# (a fraction of the depth, in meters): rocks and ledges in shallow water stay sharp, deep-water triangles melt into
# smooth slopes, the way a real seafloor looks. And the relief light is gentler the deeper it is.
DEEP_COLOR = 0.15          # extra smoothing ≈ 0.12 × depth for colors
DEEP_SHADE = 0.25          # ≈ 0.35 × depth for light & shadow
DEEP_LINE = 0.10           # ≈ 0.16 × depth for contour lines
FILL_HOLES = True          # v6: fill pinhole no-data inside surveys
SIG_CAP = MARGIN / 3       # px: never smooth wider than the margin read around the square (no seams)

ZF_NEAR, ZF_MID, ZF_FAR = 5.0, 5.5, 8.0   # relief height exaggeration: zoom ≥ 15 · 13–14 · farther out
LIGHT_ALT = 42             # sun height (degrees): lower = longer shadows, more dramatic
SHADE_GAIN = 0.85          # how strong light & shadow are
SHADE_MIN, SHADE_MAX = 0.42, 1.12   # darkest / brightest the shading may go
DEEP_LIGHT = 0.45          # light & shadow strength left at ~400 m deep (1 = same as shallow)
LINE_WIDTH = 1.0           # contour line thickness (× normal)
LINE_ALPHA = 1.0           # contour line strength (× normal)
LINES = True               # draw contour lines
LABELS = True              # depth numbers on the lines (zoom 14+)

DEPTH_STOPS_FT = [0, 6, 15, 30, 60, 120, 250, 500, 1000, 3000]
DEPTH_COLORS = np.array([
    [236, 226, 128], [205, 228, 122], [160, 220, 140], [104, 206, 178], [70, 186, 210],
    [48, 156, 214], [40, 130, 202], [34, 108, 182], [30, 90, 160], [28, 76, 140]], dtype=np.float64)

# Oct 30 (Map Studio): every look setting above can be overridden by a "style" — a plain dict with the same names
# (COLORS = 10 hex colors for DEPTH_STOPS_FT). Map Studio makes one; Send to app saves it; the HD builder draws with it.
STYLE_KEYS = ("CELLS", "SHADE_CELLS", "LINE_CELLS", "DEEP_COLOR", "DEEP_SHADE", "DEEP_LINE", "FILL_HOLES", "ZF_NEAR", "ZF_MID",
              "ZF_FAR", "LIGHT_ALT", "SHADE_GAIN", "SHADE_MIN", "SHADE_MAX", "DEEP_LIGHT", "LINE_WIDTH", "LINE_ALPHA", "LINES", "LABELS")


def _hex(c: str) -> list:
    c = c.lstrip("#")
    return [int(c[i:i + 2], 16) for i in (0, 2, 4)]


def default_style() -> dict:
    g = globals()
    d = {k: g[k] for k in STYLE_KEYS}
    d["COLORS"] = ["#%02X%02X%02X" % tuple(int(v) for v in c) for c in DEPTH_COLORS]
    return d


def resolve(style: dict | None) -> dict:
    """The settings to draw with: defaults (read live, so tests can change them) + whatever the style overrides."""
    st = default_style()
    for k, v in (style or {}).items():
        if k in STYLE_KEYS and isinstance(v, (int, float, bool)):
            st[k] = type(st[k])(v) if not isinstance(st[k], bool) else bool(v)
        elif k == "COLORS" and isinstance(v, list) and len(v) == len(DEPTH_STOPS_FT):
            try:
                st[k] = ["#%02X%02X%02X" % tuple(_hex(c)) for c in v]
            except Exception:
                pass
    return st


def px_m(z: int, lat: float) -> float:
    return EARTH / (2 ** z) / READ * math.cos(math.radians(lat))


def fill_nearest(a: np.ndarray) -> np.ndarray:
    from scipy import ndimage
    bad = ~np.isfinite(a)
    if not bad.any():
        return a
    if bad.all():
        return np.zeros_like(a)
    idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def smooth_by_resolution(dem: np.ndarray, res_m: np.ndarray, pxm: float, cells: float | None = None) -> np.ndarray:
    """Gaussian smoothing with the strength set per pixel by its survey's cell size (NaN = no data, kept NaN)."""
    from scipy import ndimage
    cells = CELLS if cells is None else cells
    ok = np.isfinite(dem)
    filled = fill_nearest(dem.astype(np.float64))
    r = np.where(np.isfinite(res_m), res_m, np.nanmax(res_m) if np.isfinite(res_m).any() else 8.0)
    sig = np.clip(cells * r / pxm, 0.9, SIG_CAP)            # px
    levels = np.unique(np.round(sig, 1))
    if len(levels) == 1:
        return np.where(ok, ndimage.gaussian_filter(filled, float(levels[0]), mode="nearest"), np.nan)
    # a few blur strengths, then each pixel takes the one for its resolution (blended between neighbours in sigma)
    ks = np.geomspace(levels.min(), levels.max(), num=min(5, len(levels)))
    stack = np.stack([ndimage.gaussian_filter(filled, float(k), mode="nearest") for k in ks])
    pos = np.interp(sig, ks, np.arange(len(ks)))
    lo = np.floor(pos).astype(int); hi = np.minimum(lo + 1, len(ks) - 1); t = pos - lo
    out = np.take_along_axis(stack, lo[None], 0)[0] * (1 - t) + np.take_along_axis(stack, hi[None], 0)[0] * t
    return np.where(ok, out, np.nan)


def hillshade(elev_m: np.ndarray, pxm: float, z: int, st: dict | None = None) -> np.ndarray:
    """0..1 relief light from a smooth surface (Horn's method), several light directions."""
    from scipy import ndimage
    st = st or resolve(None)
    zf = st["ZF_NEAR"] if z >= 15 else st["ZF_MID"] if z >= 13 else st["ZF_FAR"]      # exaggeration: less when zoomed in
    e = elev_m * zf
    gx = ndimage.sobel(e, axis=1, mode="nearest") / (8 * pxm)
    gy = ndimage.sobel(e, axis=0, mode="nearest") / (8 * pxm)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    alt = math.radians(st["LIGHT_ALT"])
    hs = np.zeros_like(e)
    for az_deg, w in ((315, 0.45), (270, 0.2), (360, 0.2), (225, 0.15)):
        az = math.radians(360 - az_deg + 90)
        hs += w * (math.sin(alt) * np.cos(slope) + math.cos(alt) * np.sin(slope) * np.cos(az - aspect))
    flat = math.sin(alt)
    return np.clip(hs / flat, 0, 1.6) / 1.6 * 1.0                        # 1 / 1.6 ≈ flat ground


def depth_rgb(depth_ft: np.ndarray, colors: list | None = None) -> np.ndarray:
    cols = DEPTH_COLORS if colors is None else np.array([_hex(c) for c in colors], np.float64)
    rgb = np.empty(depth_ft.shape + (3,))
    for c in range(3):
        rgb[..., c] = np.interp(depth_ft, DEPTH_STOPS_FT, cols[:, c])
    return rgb


def draw(dem_m: np.ndarray, res_m: np.ndarray | None, z: int, lat: float, pad: int, lines: bool = True,
         style: dict | None = None) -> np.ndarray | None:
    """RGBA READ×READ for one map square. dem_m / res_m: (READ + 2·pad)² arrays (elevation m, negative = water,
    NaN = no data; survey cell size in m). None = nothing to draw."""
    n = READ
    core = (slice(pad, pad + n), slice(pad, pad + n))
    water_full = np.isfinite(dem_m) & (dem_m < 0)
    if not water_full[core].any():
        return None
    pxm = px_m(z, lat)
    st = resolve(style)
    # v6: little no-data holes inside a survey (sparse cells) showed as a checkerboard of see-through dots. Holes up
    # to a few survey cells across, surrounded by water, are filled from their neighbours; real land stays clear.
    from scipy import ndimage as _nd
    land = np.isfinite(dem_m) & (dem_m >= 0)
    it = int(np.clip(round(2 * float(np.nanmedian(res_m)) / pxm) if res_m is not None and np.isfinite(res_m).any() else 3, 2, 12))
    holes = _nd.binary_closing(water_full, iterations=it, border_value=1) & ~np.isfinite(dem_m) & ~land
    if st["FILL_HOLES"] and holes.any():
        dem_m = np.where(holes, fill_nearest(np.where(water_full, dem_m, np.nan).astype(np.float64)), dem_m)
        water_full = water_full | holes
    if res_m is None:
        res_m = np.full(dem_m.shape, 8.0, np.float32)
    raw = np.where(np.isfinite(dem_m), dem_m, np.nan)
    from scipy import ndimage
    dep = ndimage.gaussian_filter(np.clip(-fill_nearest(raw.astype(np.float64)), 0, None), 6, mode="nearest")   # m
    res_m = np.where(np.isfinite(res_m), res_m, 8.0)
    smooth = smooth_by_resolution(raw, np.maximum(res_m, st["DEEP_COLOR"] * dep), pxm, cells=st["CELLS"])          # colors
    relief = smooth_by_resolution(raw, np.maximum(res_m, st["DEEP_SHADE"] * dep), pxm, cells=st["SHADE_CELLS"])   # light & shadow
    hs = hillshade(fill_nearest(relief), pxm, z, st)
    depth_ft = np.where(water_full, np.maximum(-smooth, 0) * M_TO_FT, np.nan)
    rgb = depth_rgb(np.nan_to_num(depth_ft, nan=0.0), st["COLORS"])
    dl = st["DEEP_LIGHT"]
    amp = np.interp(dep, [0, 40, 150, 400], [1.0, 1 - (1 - dl) * 0.18, 1 - (1 - dl) * 0.73, dl])   # gentler light in deep water
    shade = 0.62 + st["SHADE_GAIN"] * amp * (hs - 1 / 1.6)   # flat ground keeps its true color; slopes lighter / darker
    shade = np.clip(shade, st["SHADE_MIN"], st["SHADE_MAX"])
    rgb = rgb * shade[..., None]
    out = np.zeros((n, n, 4), np.uint8)
    out[..., :3] = np.clip(rgb[core] * 1.0 / 0.62, 0, 255).astype(np.uint8)
    # soft edge at the shore / no-data: alpha from a slightly blurred water mask (no jagged pixel edge)
    from scipy import ndimage
    a = ndimage.gaussian_filter(water_full.astype(np.float32), 0.8)[core]
    out[..., 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
    if not lines or not st["LINES"]:
        return out
    from .contourdraw import PAD, render
    lsm = smooth_by_resolution(raw, np.maximum(res_m, st["DEEP_LINE"] * dep), pxm, cells=st["LINE_CELLS"])
    depth_ft = np.where(water_full, np.maximum(-lsm, 0) * M_TO_FT, np.nan)
    p0 = pad - PAD
    if p0 < 0:
        d = np.pad(depth_ft, PAD - pad, mode="edge"); p0 = 0
    else:
        d = depth_ft
    d = d[p0:p0 + n + 2 * PAD, p0:p0 + n + 2 * PAD]
    img = render(d, z, "hd", base=out, labels=z >= 14 and st["LABELS"], wscale=st["LINE_WIDTH"], ascale=st["LINE_ALPHA"])
    return img if img is not None else out
