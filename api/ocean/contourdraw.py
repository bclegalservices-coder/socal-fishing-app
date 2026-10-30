"""Depth contour lines, drawn like a printed chart (v3, Oct 24).

Why: the old lines were made by coloring whole pixels wherever the depth band changed. Every line was a staircase
(zigzags), bold lines were fattened to 3 px, and on steep walls dozens of lines landed a few pixels apart and merged
into thick black ropes.

How the new lines are made, for each map square:
  1. Depths come from a copy of the seafloor model that is blurred a little for each zoom level (more when zoomed out),
     so survey noise and grid steps disappear but real ledges, banks and canyons stay.
  2. The depths are read with smooth (cubic) interpolation onto a square twice as sharp as the screen square
     (512 px for a 256 px tile, so lines stay crisp on Retina phones), with a margin around it so lines meet the
     neighbouring squares exactly.
  3. Lines are traced *between* pixels (contourpy), then rounded off (Chaikin), so they are smooth curves.
  4. Crowding control: a line is only drawn where it would sit at least GAP px from the next line of its kind. On a
     steep wall you get the 100 / 500 ft lines; on flat ground every 10 or 20 ft. No more ropes.
  5. Drawn anti-aliased (supersampled), hairline minor lines and slightly heavier index lines, with depth numbers
     written along the index lines, upright, with a light halo.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np

SCALE = 2                      # image pixels per screen pixel (256 px tile -> 512 px image)
PAD = 24                       # margin (image px) traced beyond the square so lines join neighbours cleanly
SS = 2                         # supersampling for anti-aliasing
GAP = 7.0                      # minimum spacing (image px) between lines of the same kind
LINE = (16, 38, 58)            # chart navy
LIGHT = (214, 232, 244)        # line color over dark (deep) water
MAX_LABELS = 4                 # depth numbers per square, at most
MINOR_W, MAJOR_W = 1.3, 2.3    # image px (at 512 px: about 0.65 / 1.15 screen points)
MINOR_A, MAJOR_A = 120, 215    # opacity 0–255
STEPS = (5, 10, 20, 25, 50, 100, 250, 500, 1000)


def importance(level: float) -> int:
    """Biggest round interval this depth is a multiple of (1000 ft lines matter more than 1050 ft lines)."""
    lv = int(round(level))
    best = 1
    for s in STEPS:
        if lv % s == 0:
            best = s
    return best


def levels(density: str, z: int) -> tuple[list[float], set]:
    """Depths (ft) to trace for a zoom and density, plus which are index (bold, labeled) lines."""
    r = lambda a, b, s: list(range(a, b + 1, s))      # noqa: E731
    if density == "hd":
        lv = (r(10, 100, 10) + r(120, 300, 20) + r(350, 1000, 50) + r(1100, 3000, 100) if z >= 15 else
              r(20, 100, 20) + r(150, 300, 50) + r(400, 3000, 100) if z >= 13 else
              [30, 60, 100, 200, 300, 600, 1000, 1500, 2000, 3000])
    elif density == "max":
        lv = (r(10, 100, 10) + r(120, 300, 20) + r(350, 1000, 50) + r(1100, 3000, 100) + r(3500, 8000, 500) if z >= 13 else
              r(20, 300, 20) + r(350, 1000, 50) + r(1100, 3000, 100) + r(3500, 8000, 500) if z == 12 else
              r(50, 300, 50) + r(400, 1000, 100) + r(1250, 3000, 250) + r(3500, 8000, 500) if z == 11 else
              r(100, 1000, 100) + r(1500, 8000, 500))
    else:
        lv = (r(20, 100, 20) + r(150, 300, 50) + r(400, 1000, 100) + r(1250, 3000, 250) + r(3500, 8000, 500) if z >= 12 else
              r(50, 300, 50) + r(400, 1000, 100) + r(1500, 8000, 500) if z == 11 else
              [60, 120, 300, 600, 1000, 1500, 2000, 3000, 4000, 5000, 6000])
    major = {v for v in lv if v in (60, 300, 600) or (v <= 1000 and v % 100 == 0 and z >= 13) or v % 500 == 0}
    return [float(v) for v in lv], major


def blur_sigma_px(z: int, data_res_m: float, lat: float) -> float:
    """How much to smooth (in image px) so the model's grid never shows as steps or wiggles."""
    px_m = 40075016.685578488 / (2 ** z) / (256 * SCALE) * math.cos(math.radians(lat))
    cell_px = data_res_m / px_m
    return max(1.2, 0.55 * cell_px)


def smooth_tile_depth(depth_ft: np.ndarray, sigma_px: float) -> np.ndarray:
    """Gaussian blur that ignores land (NaN) and never lets land heights leak into the water."""
    from scipy import ndimage
    water = np.isfinite(depth_ft)
    v = np.where(water, depth_ft, 0.0)
    w = ndimage.gaussian_filter(water.astype(np.float64), sigma_px, mode="nearest")
    s = ndimage.gaussian_filter(v, sigma_px, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = s / w
    return np.where(water, out, np.nan)


def _chaikin(p: np.ndarray, n: int = 2) -> np.ndarray:
    closed = len(p) > 3 and np.allclose(p[0], p[-1])
    for _ in range(n):
        if len(p) < 3:
            break
        q = 0.75 * p[:-1] + 0.25 * p[1:]
        r = 0.25 * p[:-1] + 0.75 * p[1:]
        mid = np.empty((2 * len(q), 2)); mid[0::2] = q; mid[1::2] = r
        p = np.vstack([mid, mid[:1]]) if closed else np.vstack([p[:1], mid, p[-1:]])
    return p


def trace(depth_ft: np.ndarray, lvls: list[float]):
    """{level: [polyline (N×2, x/y image px incl. margin)]} traced between pixels (NaN = land)."""
    import contourpy
    h, w = depth_ft.shape
    z = np.ma.masked_invalid(depth_ft)
    gen = contourpy.contour_generator(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64), z,
                                      line_type=contourpy.LineType.Separate, name="serial")
    out = {}
    lo, hi = np.nanmin(depth_ft) if np.isfinite(depth_ft).any() else 0, np.nanmax(depth_ft) if np.isfinite(depth_ft).any() else 0
    for lv in lvls:
        if lv < lo or lv > hi:
            continue
        lines = [np.asarray(a, dtype=np.float64) for a in gen.lines(lv) if len(a) >= 2]
        if lines:
            out[lv] = lines
    return out


def _runs(mask: np.ndarray):
    """Start/end index pairs of consecutive True values."""
    if not mask.any():
        return []
    d = np.diff(np.r_[0, mask.astype(np.int8), 0])
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]))


def declutter(lines_by_level, slope_px: np.ndarray, major: set, min_len: float = 10.0):
    """Keep each line only where it has room (see GAP). slope_px = depth change (ft) per image px."""
    h, w = slope_px.shape
    out = {}
    for lv, lines in lines_by_level.items():
        room = importance(lv)
        keep_lines = []
        for p in lines:
            xi = np.clip(p[:, 0].round().astype(int), 0, w - 1)
            yi = np.clip(p[:, 1].round().astype(int), 0, h - 1)
            spacing = room / np.maximum(slope_px[yi, xi], 1e-6)          # px to the next line of this kind
            ok = spacing >= (GAP * 0.8 if lv in major else GAP)
            for a, b in _runs(ok):
                seg = p[a:b]
                if len(seg) >= 2 and np.hypot(*np.diff(seg, axis=0).T).sum() >= min_len:
                    keep_lines.append(seg)
        if keep_lines:
            out[lv] = keep_lines
    return out


@lru_cache(maxsize=4)
def _font(size: int):
    from PIL import ImageFont
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()


def _label_spots(lines_by_level, major: set, n: int, pad: int, room: float = 180.0, per_level: int = 2):
    """Places along index lines for depth numbers: straight-ish stretches, inside the square, apart from each other."""
    spots = []
    for lv in sorted(lines_by_level, key=lambda v: -importance(v)):
        if lv not in major:
            continue
        got = 0
        for p in sorted(lines_by_level[lv], key=lambda a: -len(a)):
            if len(p) < 8:
                continue
            seg = np.hypot(*np.diff(p, axis=0).T)
            cum = np.r_[0, np.cumsum(seg)]
            if cum[-1] < 70:
                continue
            for frac in (0.5, 0.25, 0.75):
                t = cum[-1] * frac
                i = int(np.searchsorted(cum, t))
                i = min(max(i, 2), len(p) - 3)
                x, y = p[i]
                if not (pad + 30 < x < pad + n - 30 and pad + 20 < y < pad + n - 20):
                    continue
                a, b = p[max(0, i - 4)], p[min(len(p) - 1, i + 4)]
                ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
                if ang > 90:
                    ang -= 180
                if ang < -90:
                    ang += 180
                if all((x - sx) ** 2 + (y - sy) ** 2 > room ** 2 for sx, sy, _, _ in spots):
                    spots.append((x, y, ang, int(lv)))
                    got += 1
                    break
            if got >= per_level:
                break
    return spots


def render(depth_ft: np.ndarray, z: int, density: str, *, slope_px: np.ndarray | None = None, labels: bool | None = None,
           color=LINE, base: np.ndarray | None = None, halo=(255, 255, 255), wscale: float = 1.0, ascale: float = 1.0) -> np.ndarray | None:
    """Contour lines for one square. depth_ft: (n+2·PAD)² image-px depths (ft, positive down, NaN = land), already smoothed.
    Returns an RGBA n×n image (transparent background, or drawn over `base` when given)."""
    from PIL import Image, ImageDraw
    full = depth_ft.shape[0]
    n = full - 2 * PAD
    if not np.isfinite(depth_ft[PAD:PAD + n, PAD:PAD + n]).any():
        return None
    lvls, major = levels(density, z)
    if slope_px is None:
        gy, gx = np.gradient(np.where(np.isfinite(depth_ft), depth_ft, np.nanmean(depth_ft)))
        slope_px = np.hypot(gx, gy)
    lines = declutter(trace(depth_ft, lvls), slope_px, major)
    if base is None and not lines:
        return None
    # lines go into a coverage mask first (anti-aliased), then get their color: chart navy on light water, and a light
    # line on dark deep water so they never disappear (HD bottom's deep shading)
    big = Image.new("L", (n * SS, n * SS), 0)
    d = ImageDraw.Draw(big)
    for lv in sorted(lines, key=lambda v: v in major):            # index lines on top
        wd = (MAJOR_W if lv in major else MINOR_W) * SS * wscale
        a = int(min(255, (MAJOR_A if lv in major else MINOR_A) * ascale))
        for p in lines[lv]:
            q = _chaikin(p, 2)
            pts = [((x - PAD) * SS, (y - PAD) * SS) for x, y in q]
            if len(pts) >= 2:
                d.line(pts, fill=a, width=max(1, int(round(wd))), joint="curve")
    cover = np.asarray(big.resize((n, n), Image.LANCZOS), dtype=np.float32)
    img = np.zeros((n, n, 4), np.uint8)
    t = np.ones((n, n), np.float32)                                # 1 = navy line, 0 = light line (blended, no sudden flips)
    if base is not None:
        from scipy import ndimage
        lum = base[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
        t = np.clip((ndimage.gaussian_filter(lum, 12) - 70.0) / 60.0, 0, 1)
    dark = t < 0.5
    img[..., :3] = np.clip(np.array(LIGHT, np.float32) * (1 - t[..., None]) + np.array(color, np.float32) * t[..., None], 0, 255).astype(np.uint8)
    img[..., 3] = np.clip(cover * (0.85 + 0.15 * t), 0, 255).astype(np.uint8)
    img = Image.fromarray(img, "RGBA")
    show_labels = (z >= 11) if labels is None else labels
    if show_labels and lines:
        fsize = 21 if n >= 512 else 11
        f = _font(fsize)
        for x, y, ang, v in _label_spots(lines, major, n, PAD, per_level=1 if z >= 14 else 2)[:MAX_LABELS]:
            on_dark = bool(dark[min(n - 1, max(0, int(y - PAD))), min(n - 1, max(0, int(x - PAD)))])
            fg, hal = ((235, 245, 252), (10, 30, 50)) if on_dark else (color, halo)
            txt = f"{v}"
            tw = int(f.getlength(txt)) + 10
            th = fsize + 10
            lab = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
            ld = ImageDraw.Draw(lab)
            ld.text((tw / 2, th / 2), txt, font=f, anchor="mm", fill=fg + (255,), stroke_width=3, stroke_fill=hal + (225,))
            lab = lab.rotate(-ang, resample=Image.BICUBIC, expand=True)
            img.alpha_composite(lab, (int(x - PAD - lab.width / 2), int(y - PAD - lab.height / 2)))
    if base is not None:
        b = Image.fromarray(base, "RGBA")
        b.alpha_composite(img)
        return np.array(b)
    return np.array(img)
