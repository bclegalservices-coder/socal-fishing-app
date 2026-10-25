import numpy as np

# Water temperature: 24 crisp 1 °F bands (54–78 °F), each its own color — the look fishermen know from SST charts,
# so a 1-degree break is easy to see. Colors: the "Turbo" rainbow (Google), sampled once per degree.
SST_F = {"min": 54.0, "max": 78.0, "bands": 1.0, "stops": [
    "#493dab", "#4a57db", "#4172f3", "#368df9", "#2ca6f1", "#26bee0", "#26d2ca", "#2de3b1", "#3cf198", "#50f980", "#6afd6a", "#87fd58",
    "#a5f749", "#c3ed3c", "#ddde33", "#f2cb2c", "#ffb526", "#ff9c21", "#ff811d", "#fa6619", "#e84b14", "#d0330e", "#b71f08", "#a01101"]}
# Chlorophyll (Oct 24, v2): 20 crisp bands, each 1/10 of a tenfold step, from 0.05 to 5 mg/m³ — the range SoCal water
# actually spans. Deep "blue water" is rich blue, the 0.15–0.4 edge fish hold on turns cyan → aqua → green in a few
# steps, and green coastal water runs yellow → orange. (Was 0.03–10 in 7 blended colors: most of the map ended up
# the same muddy teal.)
CHL = {"min": 0.05, "max": 5.0, "log": True, "bands": True, "stops": [
    "#1a1466", "#1c2a8f", "#1a43b3", "#1760cf", "#1a7fe0", "#1f9ee8", "#22bde6", "#20d3d1", "#1fd9a8", "#2bd37e",
    "#4fd258", "#82d83f", "#b5df33", "#e2e22e", "#f6cf2a", "#f9b126", "#f78f23", "#ee6c22", "#d94c21", "#b53420"]}
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
        # Crisp bands: every value in a band gets exactly that band's color (no blending between colors).
        idx = np.clip(np.floor(tt * len(stops)).astype(int), 0, len(stops) - 1)
        out[..., :3] = stops[idx].astype(np.uint8)
    else:
        xs = np.linspace(0, 1, len(stops))
        for c in range(3):
            out[..., c] = np.interp(tt, xs, stops[:, c]).astype(np.uint8)
    out[..., 3] = np.where(np.isnan(v), 0, alpha).astype(np.uint8)
    return out


def legend(cmap: dict, unit: str, ticks: list[float]) -> dict:
    return {"min": cmap["min"], "max": cmap["max"], "log": bool(cmap.get("log")), "stops": cmap["stops"], "unit": unit, "ticks": ticks,
            "bands": bool(cmap.get("bands"))}
