"""Temperature-break and chlorophyll-edge detection (spec §12, §15).

1. Fill small gaps, smooth gently (Gaussian) so sensor noise isn't called a break.
2. Gradient magnitude in units per nautical mile (accounts for longitude shrinking with latitude).
3. Isolines every `interval`, kept only where the gradient is moderate or strong.
"""
import math

import numpy as np
from scipy import ndimage

from .contours import segments, to_multiline
from .grid import Grid


def nan_gaussian(values: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing that ignores NaN instead of spreading it."""
    v = np.where(np.isnan(values), 0.0, values).astype(np.float64)
    w = (~np.isnan(values)).astype(np.float64)
    vs = ndimage.gaussian_filter(v, sigma, mode="nearest")
    ws = ndimage.gaussian_filter(w, sigma, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = vs / ws
    out[np.isnan(values)] = np.nan
    return out


def gradient_per_nm(g: Grid, sigma_cells: float = 1.0, log10: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Returns (smoothed field, gradient magnitude per NM)."""
    vals = g.values.astype(np.float64)
    if log10:
        with np.errstate(invalid="ignore", divide="ignore"):
            vals = np.where(vals > 0, np.log10(vals), np.nan)
    sm = nan_gaussian(vals, sigma_cells) if sigma_cells > 0 else vals
    dy_nm = g.dlat * 60.0
    coslat = np.cos(np.radians(g.lats))[:, None]
    dx_nm = g.dlon * 60.0 * coslat
    gy = np.gradient(sm, axis=0) / dy_nm
    gx = np.gradient(sm, axis=1) / dx_nm
    return sm, np.hypot(gx, gy)


def classify(mag: float | None, moderate: float, strong: float) -> str:
    if mag is None or not np.isfinite(mag):
        return "none"
    return "strong" if mag >= strong else "moderate" if mag >= moderate else "none"


def _keep_long(segs: list, mags: list, min_len_nm: float) -> tuple[list, list]:
    """Join touching segments into lines and drop lines that reach less than min_len_nm end to end (specks, squiggles)."""
    if min_len_nm <= 0 or not segs:
        return segs, mags
    parent: dict = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    key = lambda p: (round(p[0], 6), round(p[1], 6))   # noqa: E731
    for p, q in segs:
        ra, rb = find(key(p)), find(key(q))
        if ra != rb:
            parent[ra] = rb
    # judge each line by how far it reaches end to end (its size), so a little closed ring around a warm or cold
    # speck doesn't count as a break just because it goes round and round
    box: dict = {}
    for p, q in segs:
        r = find(key(p))
        b = box.get(r, [p[0], p[0], p[1], p[1]])
        for x, y in (p, q):
            b[0], b[1], b[2], b[3] = min(b[0], x), max(b[1], x), min(b[2], y), max(b[3], y)
        box[r] = b
    def span(b):
        mid = math.radians((b[2] + b[3]) / 2)
        return math.hypot((b[3] - b[2]) * 60, (b[1] - b[0]) * 60 * math.cos(mid))
    keep = [i for i, (p, q) in enumerate(segs) if span(box[find(key(p))]) >= min_len_nm]
    return [segs[i] for i in keep], [mags[i] for i in keep]


def _components(segs: list) -> list[list[int]]:
    """Indexes of segments grouped into connected lines."""
    parent: dict = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    key = lambda p: (round(p[0], 6), round(p[1], 6))   # noqa: E731
    for p, q in segs:
        ra, rb = find(key(p)), find(key(q))
        if ra != rb:
            parent[ra] = rb
    groups: dict = {}
    for i, (p, _) in enumerate(segs):
        groups.setdefault(find(key(p)), []).append(i)
    return list(groups.values())


def _span_nm(pts) -> float:
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    mid = math.radians((min(ys) + max(ys)) / 2)
    return math.hypot((max(ys) - min(ys)) * 60, (max(xs) - min(xs)) * 60 * math.cos(mid))


def break_lines_ranked(g: Grid, moderate: float, strong: float, interval: float, sigma_cells: float = 1.0,
                       water: np.ndarray | None = None, floor: float = 0.6, min_span_nm: float = 2.0) -> dict:
    """Nov 7: water-temp breaks as separate lines, each with how strong it is (`rel` = its steepest change ÷ the
    "moderate" threshold) and how far it reaches (`span_nm`), so the app can show Strongest / Strong / More / Most
    without asking the server again. Lines weaker than `floor` × moderate or reaching less than `min_span_nm` are
    left out. Strong parts of a line are drawn thicker (`strength`)."""
    if water is not None:
        g = Grid(g.lats, g.lons, np.where(water, g.values, np.nan).astype(np.float32), g.meta)
    sm, mag = gradient_per_nm(g, sigma_cells, False)
    finite = sm[np.isfinite(sm)]
    if finite.size == 0:
        return {"type": "FeatureCollection", "features": []}
    lo = math.floor(finite.min() / interval) * interval
    hi = math.ceil(finite.max() / interval) * interval
    low = moderate * floor
    features = []
    level = lo
    while level <= hi + 1e-9:
        segs, mags = [], []
        for p, q, i, j in segments(g.lats, g.lons, sm, level):
            m = float(np.nanmax(mag[i:i + 2, j:j + 2]))
            if np.isfinite(m) and m >= low:
                segs.append((p, q)); mags.append(m)
        for comp in _components(segs):
            pts = [pt for k in comp for pt in segs[k]]
            span = _span_nm(pts)
            if span < min_span_nm:
                continue
            top = max(mags[k] for k in comp)
            for cls in ("strong", "moderate"):
                part = [segs[k] for k in comp if (mags[k] >= strong) == (cls == "strong")]
                if part:
                    features.append({"type": "Feature",
                                     "geometry": {"type": "MultiLineString", "coordinates": to_multiline(part)},
                                     "properties": {"level": round(level, 3), "strength": cls, "max_per_nm": round(top, 3),
                                                    "rel": round(top / moderate, 3), "span_nm": round(span, 1)}})
        level += interval
    return {"type": "FeatureCollection", "features": features}


def break_lines(g: Grid, moderate: float, strong: float, interval: float, log10: bool = False, sigma_cells: float = 1.0,
                water: np.ndarray | None = None, min_len_nm: float = 0.0) -> dict:
    """GeoJSON FeatureCollection of break lines, grouped by isoline level and strength.
    Nov 7: `water` (True = real, seen water) keeps lines off land, away from the shoreline strip, and out of
    cloud areas that were filled in; `min_len_nm` drops short squiggles so only real, solid breaks show."""
    if water is not None:
        g = Grid(g.lats, g.lons, np.where(water, g.values, np.nan).astype(np.float32), g.meta)
    sm, mag = gradient_per_nm(g, sigma_cells, log10)
    finite = sm[np.isfinite(sm)]
    if finite.size == 0:
        return {"type": "FeatureCollection", "features": []}
    lo = math.floor(finite.min() / interval) * interval
    hi = math.ceil(finite.max() / interval) * interval
    features = []
    level = lo
    while level <= hi + 1e-9:
        groups: dict[str, list] = {"moderate": [], "strong": [], "_mag": []}
        for p, q, i, j in segments(g.lats, g.lons, sm, level):
            m = np.nanmax(mag[i:i + 2, j:j + 2])
            cls = classify(float(m), moderate, strong)
            if cls != "none":
                groups[cls].append((p, q))
                groups["_mag"].append(float(m))
        if min_len_nm > 0:   # judge length on the whole line (moderate + strong parts together)
            both = [(s_, "moderate") for s_ in groups["moderate"]] + [(s_, "strong") for s_ in groups["strong"]]
            kept, _ = _keep_long([x[0] for x in both], [x[1] for x in both], min_len_nm)
            kept_set = {id(k) for k in kept}
            groups["moderate"] = [s_ for s_ in groups["moderate"] if id(s_) in kept_set]
            groups["strong"] = [s_ for s_ in groups["strong"] if id(s_) in kept_set]
        for cls in ("moderate", "strong"):
            if groups[cls]:
                shown = 10 ** level if log10 else level
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "MultiLineString", "coordinates": to_multiline(groups[cls])},
                    "properties": {"level": round(shown, 3), "strength": cls,
                                   "max_per_nm": round(max(groups["_mag"]), 3)},
                })
        level += interval
    return {"type": "FeatureCollection", "features": features}


def describe_near(g: Grid, lat: float, lon: float, radius_nm: float, moderate: float, strong: float, log10: bool = False) -> dict | None:
    """The strongest break within radius of a point, in fisherman terms:
    where it is, the values on each side, and how wide the transition is."""
    sm, mag = gradient_per_nm(g, 1.0, log10)
    dlat = radius_nm / 60.0
    dlon = radius_nm / (60.0 * max(0.2, math.cos(math.radians(lat))))
    ii = np.where((g.lats >= lat - dlat) & (g.lats <= lat + dlat))[0]
    jj = np.where((g.lons >= lon - dlon) & (g.lons <= lon + dlon))[0]
    if ii.size == 0 or jj.size == 0:
        return None
    sub = mag[np.ix_(ii, jj)]
    if not np.isfinite(sub).any():
        return None
    # among cells close to the strongest gradient, take the one nearest the point
    peak = np.nanmax(sub)
    cand = np.argwhere(np.nan_to_num(sub, nan=-1) >= 0.9 * peak)
    clat = g.lats[ii[cand[:, 0]]]; clon = g.lons[jj[cand[:, 1]]]
    dist2 = ((clat - lat) * 60) ** 2 + ((clon - lon) * 60 * math.cos(math.radians(lat))) ** 2
    ci, cj = cand[int(np.argmin(dist2))]
    bi, bj = ii[ci], jj[cj]
    m = float(mag[bi, bj])
    if classify(m, moderate, strong) == "none":
        return None
    # values ~1 NM either side, along the gradient direction
    gy = np.gradient(sm, axis=0)[bi, bj] / (g.dlat * 60)
    gx = np.gradient(sm, axis=1)[bi, bj] / (g.dlon * 60 * math.cos(math.radians(g.lats[bi])))
    norm = math.hypot(gx, gy) or 1.0
    uy, ux = gy / norm, gx / norm
    blat, blon = float(g.lats[bi]), float(g.lons[bj])
    step = 1.0
    a_lat, a_lon = blat - uy * step / 60, blon - ux * step / (60 * math.cos(math.radians(blat)))
    b_lat, b_lon = blat + uy * step / 60, blon + ux * step / (60 * math.cos(math.radians(blat)))
    va = float(g.sample(a_lat, a_lon)); vb = float(g.sample(b_lat, b_lon))
    if not (np.isfinite(va) and np.isfinite(vb)):
        return None
    lo_v, hi_v = sorted([va, vb])
    from core.geo import distance_nm, bearing
    return {
        "lat": blat, "lon": blon, "strength": classify(m, moderate, strong), "per_nm": round(m, 3),
        "from_value": round(lo_v, 3), "to_value": round(hi_v, 3),
        "change": round(hi_v - lo_v, 3), "width_nm": round((hi_v - lo_v) / m, 2) if m > 0 and not log10 else None,
        "distance_nm": round(distance_nm(lat, lon, blat, blon), 2), "bearing": round(bearing(lat, lon, blat, blon)),
    }
