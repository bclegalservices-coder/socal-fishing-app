"""The water map auto-routing uses (built once by `python -m ocean.jobs navmask`, stored in R2).

Two layers:
  • FINE tiles (~10 m cells) wherever there is coast: harbors, marinas, breakwaters, jetties, islands. Each tile is
    0.05° square (500 × 500 cells) and says, per cell, water or not and the charted depth in feet.
  • A COARSE grid (~200 m cells) for the whole region, for the long open-water part of a trip.
Tiles with no coast at all are stored as one flag (all water / all land), so the whole region is only a few MB.

Depth values (uint8, feet): 0 = land/obstruction, 1–254 = charted depth, 255 = water of unknown depth.
"""
from __future__ import annotations

import io
import json
import math
from collections import OrderedDict

import numpy as np

PREFIX = "nav/v1"
TILE = 0.05          # degrees per fine tile
FRES = 0.0001        # degrees per fine cell (~11 m north–south, ~9 m east–west at 33.5°N)
N = 500              # fine cells per tile side
CRES = 0.002         # degrees per coarse cell (~200 m)
K = 20               # fine cells per coarse cell side
WATER, LAND, FINE = 0, 1, 2   # tile kinds
UNKNOWN = 255


def pack(water: np.ndarray, depth: np.ndarray) -> bytes:
    buf = io.BytesIO()
    np.savez_compressed(buf, shape=np.array(water.shape), bits=np.packbits(water.ravel()), depth=depth.astype(np.uint8))
    return buf.getvalue()


def unpack(raw: bytes) -> tuple[np.ndarray, np.ndarray]:
    z = np.load(io.BytesIO(raw))
    shape = tuple(int(x) for x in z["shape"])
    water = np.unpackbits(z["bits"])[: shape[0] * shape[1]].reshape(shape).astype(bool)
    return water, z["depth"].astype(np.uint8)


class Window:
    """A rectangle of the water map at one resolution. Row 0 = south edge, column 0 = west edge.
    Cell (i, j) covers lat0 + i·res … lat0 + (i+1)·res."""

    def __init__(self, lon0: float, lat0: float, res: float, water: np.ndarray, depth: np.ndarray):
        self.lon0, self.lat0, self.res = lon0, lat0, res
        self.water, self.depth = water, depth

    @property
    def shape(self):
        return self.water.shape

    def cell(self, lat: float, lon: float) -> tuple[int, int]:
        i = int(math.floor((lat - self.lat0) / self.res))
        j = int(math.floor((lon - self.lon0) / self.res))
        return min(max(i, 0), self.shape[0] - 1), min(max(j, 0), self.shape[1] - 1)

    def center(self, i: int, j: int) -> tuple[float, float]:
        """(lat, lon) of a cell's middle."""
        return self.lat0 + (i + 0.5) * self.res, self.lon0 + (j + 0.5) * self.res


class NavData:
    """Reads the stored water map. Fine tiles are loaded on demand and kept in a small memory cache."""

    def __init__(self, store, prefix: str = PREFIX, cache_tiles: int = 120):
        self.store, self.prefix, self.cache_tiles = store, prefix, cache_tiles
        raw = store.get(f"{prefix}/meta.json")
        if not raw:
            raise FileNotFoundError("water map not built yet")
        self.meta = json.loads(raw)
        self.lon0, self.lat0, self.lon1, self.lat1 = self.meta["bbox"]
        z = np.load(io.BytesIO(store.get(f"{prefix}/kinds.npz")))
        self.kinds = z["kinds"].astype(np.uint8)
        cw, cd = unpack(store.get(f"{prefix}/coarse.npz"))
        self.cwater, self.cdepth = cw, cd
        self._tiles: OrderedDict[tuple[int, int], tuple[np.ndarray, np.ndarray]] = OrderedDict()

    # ---- fine tiles
    def tile(self, ti: int, tj: int) -> tuple[np.ndarray, np.ndarray] | int:
        """(water, depth) arrays for a fine tile, or WATER / LAND for a tile without coast."""
        if not (0 <= ti < self.kinds.shape[0] and 0 <= tj < self.kinds.shape[1]):
            return WATER                                    # outside the region: open water
        k = int(self.kinds[ti, tj])
        if k != FINE:
            return k
        key = (ti, tj)
        if key in self._tiles:
            self._tiles.move_to_end(key)
            return self._tiles[key]
        raw = self.store.get(f"{self.prefix}/t/{ti}_{tj}.npz")
        if raw is None:
            return self._coarse_tile(ti, tj)                # not built yet: rough coastline from the coarse grid
        t = unpack(raw)
        self._tiles[key] = t
        if len(self._tiles) > self.cache_tiles:
            self._tiles.popitem(last=False)
        return t

    def _coarse_tile(self, ti: int, tj: int):
        ci, cj = ti * (N // K), tj * (N // K)
        w = self.cwater[ci:ci + N // K, cj:cj + N // K]
        d = self.cdepth[ci:ci + N // K, cj:cj + N // K]
        return np.repeat(np.repeat(w, K, 0), K, 1), np.repeat(np.repeat(d, K, 0), K, 1)

    def fine(self, lon0: float, lat0: float, lon1: float, lat1: float, step: int = 1) -> Window:
        """The fine water map for a rectangle (snapped to the fine grid). step=2 merges 2×2 cells (water only
        where all four are water — never opens a gap through a breakwater)."""
        gi0 = int(math.floor((lat0 - self.lat0) / FRES)); gi1 = int(math.ceil((lat1 - self.lat0) / FRES))
        gj0 = int(math.floor((lon0 - self.lon0) / FRES)); gj1 = int(math.ceil((lon1 - self.lon0) / FRES))
        gi1 = gi0 + ((gi1 - gi0 + step - 1) // step) * step
        gj1 = gj0 + ((gj1 - gj0 + step - 1) // step) * step
        h, w = gi1 - gi0, gj1 - gj0
        water = np.ones((h, w), dtype=bool)
        depth = np.full((h, w), UNKNOWN, dtype=np.uint8)
        for ti in range(gi0 // N, (gi1 - 1) // N + 1):
            for tj in range(gj0 // N, (gj1 - 1) // N + 1):
                a0, a1 = max(gi0, ti * N), min(gi1, (ti + 1) * N)
                b0, b1 = max(gj0, tj * N), min(gj1, (tj + 1) * N)
                if a0 >= a1 or b0 >= b1:
                    continue
                t = self.tile(ti, tj)
                dst = (slice(a0 - gi0, a1 - gi0), slice(b0 - gj0, b1 - gj0))
                if isinstance(t, int):
                    if t == LAND:
                        water[dst] = False; depth[dst] = 0
                    continue
                src = (slice(a0 - ti * N, a1 - ti * N), slice(b0 - tj * N, b1 - tj * N))
                water[dst] = t[0][src]; depth[dst] = t[1][src]
        if step > 1:
            water = water.reshape(h // step, step, w // step, step).all(axis=(1, 3))
            depth = depth.reshape(h // step, step, w // step, step).min(axis=(1, 3))
        return Window(self.lon0 + gj0 * FRES, self.lat0 + gi0 * FRES, FRES * step, water, depth)

    def coarse(self, lon0: float, lat0: float, lon1: float, lat1: float, step: int = 1) -> Window:
        ci0 = max(0, int(math.floor((lat0 - self.lat0) / CRES))); ci1 = min(self.cwater.shape[0], int(math.ceil((lat1 - self.lat0) / CRES)))
        cj0 = max(0, int(math.floor((lon0 - self.lon0) / CRES))); cj1 = min(self.cwater.shape[1], int(math.ceil((lon1 - self.lon0) / CRES)))
        w = self.cwater[ci0:max(ci1, ci0 + 1), cj0:max(cj1, cj0 + 1)]; d = self.cdepth[ci0:max(ci1, ci0 + 1), cj0:max(cj1, cj0 + 1)]
        if step > 1:
            h2, w2 = w.shape[0] // step, w.shape[1] // step
            w = w[: h2 * step, : w2 * step].reshape(h2, step, w2, step).all(axis=(1, 3))
            d = d[: h2 * step, : w2 * step].reshape(h2, step, w2, step).min(axis=(1, 3))
        return Window(self.lon0 + cj0 * CRES, self.lat0 + ci0 * CRES, CRES * step, w.copy(), d.copy())

    def sample(self, lats: np.ndarray, lons: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Fine water flag and depth at many points (outside the region counts as open water)."""
        lats = np.asarray(lats, dtype=np.float64); lons = np.asarray(lons, dtype=np.float64)
        gi = np.floor((lats - self.lat0) / FRES).astype(np.int64)
        gj = np.floor((lons - self.lon0) / FRES).astype(np.int64)
        ti, tj = np.floor_divide(gi, N), np.floor_divide(gj, N)
        water = np.ones(lats.shape, dtype=bool)
        depth = np.full(lats.shape, UNKNOWN, dtype=np.uint8)
        pairs = np.stack([ti.ravel(), tj.ravel()], axis=1) if lats.size else np.zeros((0, 2), dtype=np.int64)
        for a, b in {(int(x), int(y)) for x, y in pairs}:
            m = (ti == a) & (tj == b)
            t = self.tile(a, b)
            if isinstance(t, int):
                if t == LAND:
                    water[m] = False; depth[m] = 0
                continue
            ii, jj = gi[m] - a * N, gj[m] - b * N
            water[m] = t[0][ii, jj]; depth[m] = t[1][ii, jj]
        return water, depth

    def coarse_open(self, lat: float, lon: float, safety_ft: float) -> bool:
        """Open water at the coarse scale: the whole ~200 m cell and its neighbours are water, deep enough."""
        ci = int(math.floor((lat - self.lat0) / CRES)); cj = int(math.floor((lon - self.lon0) / CRES))
        if not (1 <= ci < self.cwater.shape[0] - 1 and 1 <= cj < self.cwater.shape[1] - 1):
            return True
        blk = self.cwater[ci - 1:ci + 2, cj - 1:cj + 2]
        d = int(self.cdepth[ci, cj])
        return bool(blk.all()) and (d == UNKNOWN or d >= safety_ft)
