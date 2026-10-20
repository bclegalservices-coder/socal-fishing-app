import numpy as np

SST_F = {"min": 54.0, "max": 76.0, "stops": ["#243f8f", "#2f6fb6", "#2f9fc0", "#5fbfa6", "#d8cd6a", "#f2a33a", "#e7663a", "#b8322a"]}
CHL = {"min": 0.03, "max": 10.0, "log": True, "stops": ["#1b2a6b", "#1f5f8b", "#1f8f8a", "#3fae6a", "#9cc95a", "#e1d85a", "#b0753a"]}
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
    xs = np.linspace(0, 1, len(stops))
    out = np.zeros(v.shape + (4,), dtype=np.uint8)
    tt = np.nan_to_num(t, nan=0.0)
    for c in range(3):
        out[..., c] = np.interp(tt, xs, stops[:, c]).astype(np.uint8)
    out[..., 3] = np.where(np.isnan(v), 0, alpha).astype(np.uint8)
    return out


def legend(cmap: dict, unit: str, ticks: list[float]) -> dict:
    return {"min": cmap["min"], "max": cmap["max"], "log": bool(cmap.get("log")), "stops": cmap["stops"], "unit": unit, "ticks": ticks}
