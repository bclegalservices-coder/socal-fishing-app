import numpy as np

# Water temperature: 24 crisp 1 °F bands (54–78 °F), each its own color — the look fishermen know from SST charts,
# so a 1-degree break is easy to see. Colors: the "Turbo" rainbow (Google), sampled once per degree.
SST_F = {"min": 54.0, "max": 78.0, "bands": 1.0, "blend": 0.22, "stops": [
    "#493dab", "#4a57db", "#4172f3", "#368df9", "#2ca6f1", "#26bee0", "#26d2ca", "#2de3b1", "#3cf198", "#50f980", "#6afd6a", "#87fd58",
    "#a5f749", "#c3ed3c", "#ddde33", "#f2cb2c", "#ffb526", "#ff9c21", "#ff811d", "#fa6619", "#e84b14", "#d0330e", "#b71f08", "#a01101"]}
# Chlorophyll (Oct 24): the same smooth blend and color family as before (blue → teal → green → yellow → brown), but
# much richer colors and spread over 0.05–5 mg/m³ — the range SoCal water actually spans — so clean blue water is a deep,
# vivid blue and green water really pops. (Was 0.03–10 with dull colors: most of the map came out the same muddy teal.)
CHL = {"min": 0.05, "max": 5.0, "log": True, "stops": [
    "#0d1b8c", "#0f4fd1", "#0a8fd8", "#08b5ad", "#21c25a", "#a5dc23", "#f4d614", "#e98a12", "#b2481a"]}
CHL_OLD = {"min": 0.03, "max": 10.0, "log": True, "stops": ["#1b2a6b", "#1f5f8b", "#1f8f8a", "#3fae6a", "#9cc95a", "#e1d85a", "#b0753a"]}
DEPTH_FT = {"min": 0.0, "max": 6000.0, "stops": ["#cfe9f3", "#8cc4de", "#4f97c4", "#2a6a9e", "#173f6b", "#0b2140"]}


def _hex(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def apply(values: np.ndarray, cmap: dict, alpha: int = 255) -> np.ndarray:
    """values -> RGBA uint8 array. NaN -> transparent."""
    v = np.asarray(values, dtype=np.float64)
    lo, hi = cmap["min"], cmap["max"]
    with np.errstate(invalid="ignore", divide="ignore"):
        if cmap.get("log"):
            t = (np.log10(np.clip(v, lo, hi)) - np.log10(lo)) / (np.log10(hi) - np.log10(lo))
        else:
            t = (np.clip(v, lo, hi) - lo) / (hi - lo)
    stops = np.array([_hex(s) for s in cmap["stops"]], dtype=np.float64)
    out = np.zeros(v.shape + (4,), dtype=np.uint8)
    tt = np.nan_to_num(t, nan=0.0)
    if cmap.get("bands"):
        # Bands: every value in a band gets that band's color. With "blend" (a share of one band, Oct 24), the last bit
        # of each band fades smoothly into the next, so a break reads as a soft edge instead of a hard step.
        n = len(stops)
        p = np.clip(tt * n, 0, n - 1e-9)
        idx = np.floor(p).astype(int)
        col = stops[idx]
        bl = float(cmap.get("blend", 0) or 0)
        if bl > 0:
            k = np.round(p).astype(int)                       # nearest band edge
            dd = p - k
            near = (np.abs(dd) < bl) & (k > 0) & (k < n)
            t = np.clip((dd + bl) / (2 * bl), 0, 1)
            t = t * t * (3 - 2 * t)                           # smoothstep
            lo = stops[np.clip(k - 1, 0, n - 1)]; hi = stops[np.clip(k, 0, n - 1)]
            col = np.where(near[..., None], lo * (1 - t[..., None]) + hi * t[..., None], col)
        out[..., :3] = np.clip(col, 0, 255).astype(np.uint8)
    else:
        xs = np.linspace(0, 1, len(stops))
        for c in range(3):
            out[..., c] = np.interp(tt, xs, stops[:, c]).astype(np.uint8)
    out[..., 3] = np.where(np.isnan(v), 0, alpha).astype(np.uint8)
    return out


def legend(cmap: dict, unit: str, ticks: list[float]) -> dict:
    return {"min": cmap["min"], "max": cmap["max"], "log": bool(cmap.get("log")), "stops": cmap["stops"], "unit": unit, "ticks": ticks,
            "bands": bool(cmap.get("bands"))}
