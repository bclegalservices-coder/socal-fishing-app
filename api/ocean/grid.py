"""A regular lat/lon grid with metadata that never gets separated from the numbers."""
import io
import json
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Grid:
    lats: np.ndarray            # ascending, 1-D
    lons: np.ndarray            # ascending, 1-D
    values: np.ndarray          # [lat, lon], float32, NaN = no data (land / cloud)
    meta: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.lats[0] > self.lats[-1]:
            self.lats = self.lats[::-1].copy()
            self.values = self.values[::-1, :].copy()

    @property
    def dlat(self) -> float:
        return float(np.mean(np.diff(self.lats)))

    @property
    def dlon(self) -> float:
        return float(np.mean(np.diff(self.lons)))

    def frac_index(self, lat, lon):
        fi = np.interp(lat, self.lats, np.arange(self.lats.size), left=np.nan, right=np.nan)
        fj = np.interp(lon, self.lons, np.arange(self.lons.size), left=np.nan, right=np.nan)
        return fi, fj

    def sample(self, lat, lon):
        """Bilinear sample (vectorized). Falls back to nearest cell next to gaps (coastline, cloud edges)."""
        lat = np.asarray(lat, dtype=np.float64)
        lon = np.asarray(lon, dtype=np.float64)
        fi, fj = self.frac_index(lat, lon)
        out = np.full(np.broadcast(fi, fj).shape, np.nan, dtype=np.float64)
        ok = ~(np.isnan(fi) | np.isnan(fj))
        if not ok.any():
            return out if out.ndim else float("nan")
        fi_o, fj_o = np.broadcast_to(fi, out.shape)[ok], np.broadcast_to(fj, out.shape)[ok]
        i0 = np.clip(np.floor(fi_o).astype(int), 0, self.lats.size - 2)
        j0 = np.clip(np.floor(fj_o).astype(int), 0, self.lons.size - 2)
        di, dj = fi_o - i0, fj_o - j0
        v = self.values
        v00, v01, v10, v11 = v[i0, j0], v[i0, j0 + 1], v[i0 + 1, j0], v[i0 + 1, j0 + 1]
        bil = v00 * (1 - di) * (1 - dj) + v01 * (1 - di) * dj + v10 * di * (1 - dj) + v11 * di * dj
        near = v[np.rint(fi_o).astype(int).clip(0, self.lats.size - 1), np.rint(fj_o).astype(int).clip(0, self.lons.size - 1)]
        out[ok] = np.where(np.isnan(bil), near, bil)
        return out if out.ndim else float(out)

    def to_bytes(self) -> bytes:
        buf = io.BytesIO()
        np.savez_compressed(buf, lats=self.lats, lons=self.lons, values=self.values.astype(np.float32),
                            meta=np.frombuffer(json.dumps(self.meta).encode(), dtype=np.uint8))
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes) -> "Grid":
        z = np.load(io.BytesIO(data))
        return cls(z["lats"], z["lons"], z["values"], json.loads(z["meta"].tobytes().decode()))


def c_to_f(a):
    return np.asarray(a) * 9.0 / 5.0 + 32.0


def to_display_units(g: Grid) -> Grid:
    """Server units -> what fishermen read: °F for temperature, feet (positive down) for depth."""
    m = dict(g.meta)
    if m.get("units") in ("degC", "degree_C", "Celsius"):
        vals = c_to_f(g.values).astype(np.float32)
        m["units"] = "degF"
    elif m.get("units") in ("K", "kelvin"):
        vals = c_to_f(g.values - 273.15).astype(np.float32)
        m["units"] = "degF"
    elif m.get("layer") == "bathy" and m.get("units") == "m":
        vals = np.where(g.values < 0, -g.values * 3.28084, np.nan).astype(np.float32)  # land -> NaN
        m["units"] = "ft"
    else:
        vals = g.values
    return Grid(g.lats, g.lons, vals, m)
