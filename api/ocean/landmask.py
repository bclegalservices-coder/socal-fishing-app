"""Exact land mask so water temperature and chlorophyll stop cleanly at the real coastline (and never color islands).

How it's made (once per region, then saved to storage and reused every day):
  1. Download the coastline lines for the region from OpenStreetMap (Overpass API, free; © OpenStreetMap contributors).
  2. Draw them on a ~100 m grid.
  3. "Flood fill" the water starting from a point far out in the Pacific. Everything the flood can't reach — the
     mainland and every island — is land.
If anything goes wrong (Overpass down, a gap in the coastline that lets the flood leak onto land), no mask is used
and the map looks like before; the job never fails because of the mask.
"""
from __future__ import annotations

import io

import numpy as np

RES = 0.001                         # degrees (~100 m north-south, ~90 m east-west here)
SEED = (-120.9, 31.1)               # a point in the open Pacific, inside the socal region box
KEY = "masks/land-{region}-v1.npz"
_cache: dict[str, "LandMask | None"] = {}

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


class LandMask:
    def __init__(self, lon0: float, lat0: float, res: float, land: np.ndarray):
        self.lon0, self.lat0, self.res = lon0, lat0, res
        self.land = land                      # [row (lat ascending from lat0), col (lon ascending from lon0)] bool

    def is_land(self, lat, lon) -> np.ndarray:
        """True where a point is on land. Points outside the mask count as water."""
        lat = np.asarray(lat, dtype=np.float64)
        lon = np.asarray(lon, dtype=np.float64)
        i = np.floor((lat - self.lat0) / self.res).astype(np.int64)
        j = np.floor((lon - self.lon0) / self.res).astype(np.int64)
        ok = (i >= 0) & (i < self.land.shape[0]) & (j >= 0) & (j < self.land.shape[1])
        out = np.zeros(lat.shape, dtype=bool)
        out[ok] = self.land[i[ok], j[ok]]
        return out

    def to_bytes(self) -> bytes:
        buf = io.BytesIO()
        np.savez_compressed(buf, lon0=self.lon0, lat0=self.lat0, res=self.res, shape=np.array(self.land.shape),
                            bits=np.packbits(self.land.ravel()))
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes) -> "LandMask":
        z = np.load(io.BytesIO(data))
        shape = tuple(int(x) for x in z["shape"])
        land = np.unpackbits(z["bits"])[: shape[0] * shape[1]].reshape(shape).astype(bool)
        return cls(float(z["lon0"]), float(z["lat0"]), float(z["res"]), land)


def build(lines: list[list[tuple[float, float]]], bbox: tuple, res: float = RES, seed: tuple = SEED) -> LandMask:
    """lines: coastline polylines as [(lon, lat), ...]. bbox: (lon_min, lat_min, lon_max, lat_max)."""
    from PIL import Image, ImageDraw
    from scipy import ndimage
    lon_min, lat_min, lon_max, lat_max = bbox
    w = int(round((lon_max - lon_min) / res))
    h = int(round((lat_max - lat_min) / res))
    img = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(img)
    to_px = lambda lon, lat: ((lon - lon_min) / res, (lat_max - lat) / res)   # noqa: E731 (row 0 = north)
    for ln in lines:
        if len(ln) >= 2:
            d.line([to_px(*p) for p in ln], fill=1, width=2)
    coast = np.array(img, dtype=bool)
    labels, _ = ndimage.label(~coast)            # 4-connected regions between the coastline strokes
    sx, sy = to_px(*seed)
    water_id = labels[int(sy), int(sx)]
    if water_id == 0:
        raise ValueError("ocean seed point landed on the coastline")
    land = labels != water_id                    # not reachable from the open ocean (coast strokes count as land)
    return LandMask(lon_min, lat_min, res, land[::-1, :].copy())   # flip so row 0 = southern edge


def sane(m: LandMask) -> bool:
    """A leaky coastline floods the land with 'water' (land share ~0); a broken seed makes everything land."""
    share = float(m.land.mean())
    return 0.05 < share < 0.85


def fetch_coastlines(bbox: tuple, http, log=print) -> list[list[tuple[float, float]]]:
    lon_min, lat_min, lon_max, lat_max = bbox
    q = f'[out:json][timeout:240];way["natural"="coastline"]({lat_min},{lon_min},{lat_max},{lon_max});out geom;'
    last = None
    for url in OVERPASS:
        try:
            r = http.post(url, data={"data": q})
            r.raise_for_status()
            ways = r.json().get("elements", [])
            return [[(p["lon"], p["lat"]) for p in w.get("geometry", [])] for w in ways if w.get("geometry")]
        except Exception as e:
            last = e
            log(f"landmask: {url} failed ({str(e)[:150]})")
    raise RuntimeError(f"OpenStreetMap coastline download failed: {last}")


def get(region: str, bbox: tuple, store, http, log=print) -> LandMask | None:
    """The saved mask for a region, building it the first time. None = no mask (map draws as before)."""
    if region in _cache:
        return _cache[region]
    key = KEY.format(region=region)
    m = None
    try:
        raw = store.get(key) if store is not None else None
        if raw:
            m = LandMask.from_bytes(raw)
        elif http is not None:
            lines = fetch_coastlines(bbox, http, log)
            m = build(lines, bbox)
            if sane(m):
                store.put(key, m.to_bytes(), "application/octet-stream")
                log(f"landmask: built {region} from {len(lines)} coastline pieces, {m.land.mean():.0%} land")
            else:
                log(f"landmask: rejected ({m.land.mean():.0%} land — coastline has a gap); drawing without a mask")
                m = None
    except Exception as e:
        log(f"landmask: not available ({str(e)[:200]}); drawing without a mask")
        m = None
    _cache[region] = m
    return m


def fill_gaps(values: np.ndarray, max_cells: int = 3) -> np.ndarray:
    """Fill no-data cells (land and the coastal strip a coarse satellite grid leaves empty) with the nearest water
    value, so the drawn map runs smoothly right up to the coastline instead of stopping in blocky squares.
    The land mask then cuts it exactly at the shore."""
    from scipy import ndimage
    v = np.asarray(values)
    bad = ~np.isfinite(v)
    if not bad.any() or bad.all():
        return v
    dist, idx = ndimage.distance_transform_edt(bad, return_distances=True, return_indices=True)
    filled = v[tuple(idx)]
    # Only the strip next to real data (not big cloud holes far from any measurement).
    return np.where(bad & (dist > max_cells), np.nan, filled).astype(v.dtype)
