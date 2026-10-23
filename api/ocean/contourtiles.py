"""Depth contour lines drawn into map squares (raster), shared by HD bottom and the region-wide contour layer.

A line is drawn wherever two neighbouring pixels fall on different sides of a contour depth — so lines are exactly
one pixel wide and stay crisp at every zoom. Bold lines (every 100 ft; every 500 ft past 1,000 ft) get depth labels.
"""
from __future__ import annotations

import numpy as np

LINE = (14, 34, 52)          # dark navy, like a paper chart


def levels(density: str, z: int) -> tuple[np.ndarray, set]:
    """Contour depths (ft) for a density ('std' | 'max' | 'hd') and zoom, plus which of them are bold."""
    r = lambda a, b, s: list(range(a, b + 1, s))      # noqa: E731
    if density == "hd":                                # HD bottom (nearshore survey data)
        lv = (r(5, 60, 5) + r(70, 300, 10) + r(350, 3000, 50) if z >= 15 else
              r(10, 100, 10) + r(120, 300, 20) + r(400, 3000, 100) if z == 14 else
              r(20, 100, 20) + r(150, 300, 50) + r(400, 3000, 100) if z == 13 else
              [30, 60, 100, 200, 300, 600, 1000, 1500, 2000, 3000])
    elif density == "max":                             # "Max" contour detail: lots of lines
        lv = (r(10, 200, 10) + r(220, 600, 20) + r(650, 2000, 50) + r(2100, 8000, 100) if z >= 12 else
              r(20, 200, 20) + r(250, 1000, 50) + r(1100, 8000, 100) if z == 11 else
              r(50, 500, 50) + r(600, 2000, 100) + r(2250, 8000, 250))
    else:                                              # "Standard"
        lv = (r(20, 200, 20) + r(250, 1000, 50) + r(1100, 8000, 100) if z >= 12 else
              r(50, 300, 50) + r(400, 1000, 100) + r(1250, 8000, 250) if z == 11 else
              r(100, 1000, 100) + r(1500, 8000, 500))
    major = {v for v in lv if (v < 1000 and v % 100 == 0) or v % 500 == 0 or v == 60}
    return np.array(lv, dtype=np.float64), major


def contour_pixels(depth_ft: np.ndarray, water: np.ndarray, lv: np.ndarray, major: set):
    """(thin, bold, level_at_bold) masks for a depth image (ft, positive down)."""
    band = np.digitize(np.where(water, depth_ft, 0.0), lv)
    er = np.zeros(water.shape, bool); ed = np.zeros(water.shape, bool)
    er[:, :-1] = (band[:, :-1] != band[:, 1:]) & water[:, :-1] & water[:, 1:]
    ed[:-1, :] = (band[:-1, :] != band[1:, :]) & water[:-1, :] & water[1:, :]
    top = len(lv) - 1
    lr = np.zeros(water.shape); ld = np.zeros(water.shape)
    lr[:, :-1] = lv[np.clip(np.minimum(band[:, :-1], band[:, 1:]), 0, top)]
    ld[:-1, :] = lv[np.clip(np.minimum(band[:-1, :], band[1:, :]), 0, top)]
    maj = list(major)
    br = er & np.isin(lr, maj); bd = ed & np.isin(ld, maj)
    bold = br | bd
    lvl = np.where(br, lr, np.where(bd, ld, 0.0))
    return (er | ed) & ~bold, bold, lvl


def label_spots(bold: np.ndarray, lvl: np.ndarray, margin: int = 22, spacing: int = 110, per_level: int = 2):
    """A few spots on bold lines for depth numbers, away from the square's edges and from each other."""
    h, w = bold.shape
    ys, xs = np.nonzero(bold[margin:h - margin, margin:w - margin])
    if not len(ys):
        return []
    ys += margin; xs += margin
    out = []
    for v in np.unique(lvl[ys, xs]):
        sel = lvl[ys, xs] == v
        cy, cx = ys[sel], xs[sel]
        mid = len(cy) // 2
        order = np.r_[mid:len(cy), 0:mid]                  # start near the middle of the line
        n = 0
        for k in order[:: max(1, len(order) // 40)]:
            y, x = int(cy[k]), int(cx[k])
            if all((y - a) ** 2 + (x - b) ** 2 > spacing ** 2 for a, b, _ in out):
                out.append((y, x, int(v))); n += 1
                if n >= per_level:
                    break
    return out


def put_labels(img_rgba: np.ndarray, spots) -> np.ndarray:
    """Depth numbers with a white halo (needs Pillow ≥ 10.1 for the built-in font size; skipped otherwise)."""
    if not spots:
        return img_rgba
    try:
        from PIL import Image, ImageDraw, ImageFont
        font = ImageFont.load_default(size=11)
    except Exception:
        return img_rgba
    im = Image.fromarray(img_rgba, "RGBA")
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))      # drawn separately, then laid on top (keeps the map's alpha)
    d = ImageDraw.Draw(layer)
    for y, x, v in spots:
        d.text((x, y), f"{v}", font=font, fill=(14, 34, 52, 255), anchor="mm", stroke_width=2, stroke_fill=(255, 255, 255, 230))
    return np.array(Image.alpha_composite(im, layer))


def lines_only(depth_ft: np.ndarray, z: int, density: str) -> np.ndarray | None:
    """Transparent square with just the contour lines (and labels when zoomed in). depth_ft: positive down, NaN=land."""
    from scipy import ndimage
    water = np.isfinite(depth_ft) & (depth_ft > 0)
    if not water.any():
        return None
    lv, major = levels(density, z)
    thin, bold, lvl = contour_pixels(depth_ft, water, lv, major)
    if not (thin.any() or bold.any()):
        return None
    out = np.zeros(depth_ft.shape + (4,), np.uint8)
    out[..., :3] = LINE
    out[..., 3] = np.where(thin, 150, 0)
    fat = ndimage.binary_dilation(bold) & water
    out[..., 3] = np.where(fat, 235, out[..., 3])
    if z >= 11:
        out = put_labels(out, label_spots(bold, lvl))
    return out
