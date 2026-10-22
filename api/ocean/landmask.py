"""Exact land mask so water temperature and chlorophyll stop cleanly at the real coastline (and never color islands).

How it's made (once per region, then saved to storage and reused every day), on a ~100 m grid:
  1. NOAA's own chart land (ENC "Land Area" polygons, coastal charts) — the same land the NOAA chart draws, so the
     colors stop exactly where the chart's coast is. Free, public (NOAA ENC Direct to GIS).
  2. Plus OpenStreetMap coastlines, flood-filled from the open Pacific (extra detail; skipped if it fails or leaks).
  3. Plus the seafloor model's land south of the border (NOAA's US charts don't cover Mexico).
If everything fails, no mask is used and the map draws like before; the job never fails because of the mask.
"""
from __future__ import annotations

import io

import numpy as np

RES = 0.001                         # degrees (~100 m north-south, ~90 m east-west here)
SEED = (-120.9, 31.1)               # a point in the open Pacific, inside the socal region box
KEY = "masks/land-{region}-v2.npz"
_cache: dict[str, "LandMask | None"] = {}

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


ENC_LAND = ["https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/171/query",
            "https://maritimeboundaries.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/171/query"]
BORDER_LAT = 32.53                  # US–Mexico border at the coast; south of it NOAA charts have no land polygons


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


def rasterize(polys: list, bbox: tuple, res: float = RES) -> np.ndarray:
    """polys: GeoJSON Polygon/MultiPolygon geometries in lon/lat → land bool grid (row 0 = southern edge)."""
    from PIL import Image, ImageDraw
    lon_min, lat_min, lon_max, lat_max = bbox
    w = int(round((lon_max - lon_min) / res))
    h = int(round((lat_max - lat_min) / res))
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    to_px = lambda lon, lat: ((lon - lon_min) / res, (lat_max - lat) / res)   # noqa: E731
    for g in polys:
        t, c = g.get("type"), g.get("coordinates") or []
        parts = [c] if t == "Polygon" else c if t == "MultiPolygon" else []
        for rings in parts:
            if not rings or len(rings[0]) < 3:
                continue
            d.polygon([to_px(x, y) for x, y in rings[0][:]], fill=1, outline=1)
            for hole in rings[1:]:                       # lakes/lagoons inside land stay water
                if len(hole) >= 3:
                    d.polygon([to_px(x, y) for x, y in hole], fill=0)
    return np.array(img, dtype=bool)[::-1, :].copy()


def fetch_enc_land(bbox: tuple, http, log=print) -> list:
    """NOAA chart land polygons (ENC Land Area, coastal charts) intersecting bbox, as GeoJSON geometries."""
    lon_min, lat_min, lon_max, lat_max = bbox
    last = None
    for url in ENC_LAND:
        try:
            out, offset = [], 0
            while True:
                r = http.get(url, params={
                    "where": "1=1", "geometry": f"{lon_min},{lat_min},{lon_max},{lat_max}", "geometryType": "esriGeometryEnvelope",
                    "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "OBJECTID",
                    "returnGeometry": "true", "maxAllowableOffset": RES / 2, "resultOffset": offset, "resultRecordCount": 1000,
                    "f": "geojson"})
                r.raise_for_status()
                j = r.json()
                if "error" in j:
                    raise RuntimeError(str(j["error"])[:150])
                feats = j.get("features", [])
                out += [f["geometry"] for f in feats if f.get("geometry")]
                if not feats or not (j.get("exceededTransferLimit") or j.get("properties", {}).get("exceededTransferLimit")):
                    break
                offset += len(feats)
            if out:
                return out
            raise RuntimeError("no land polygons returned")
        except Exception as e:
            last = e
            log(f"landmask: NOAA chart land from {url.split('/')[2]} failed ({str(e)[:150]})")
    raise RuntimeError(f"NOAA chart land download failed: {last}")


def bathy_land(store, region: str, shape: tuple, bbox: tuple, res: float = RES, south_only: bool = True) -> np.ndarray | None:
    """Land from the seafloor model (no depth = land), on the mask grid, only south of the border."""
    try:
        from .grid import Grid
        raw = store.get(f"grids/bathy/{region}/depth.npz")
        if not raw:
            return None
        g = Grid.from_bytes(raw)
        lon_min, lat_min = bbox[0], bbox[1]
        lats = lat_min + (np.arange(shape[0]) + 0.5) * res
        lons = lon_min + (np.arange(shape[1]) + 0.5) * res
        south = lats < BORDER_LAT if south_only else np.ones(lats.size, dtype=bool)
        out = np.zeros(shape, dtype=bool)
        if not south.any():
            return out
        fi = np.clip(np.rint(np.interp(lats[south], g.lats, np.arange(g.lats.size))).astype(int), 0, g.lats.size - 1)
        fj = np.clip(np.rint(np.interp(lons, g.lons, np.arange(g.lons.size))).astype(int), 0, g.lons.size - 1)
        out[south] = ~np.isfinite(g.values[np.ix_(fi, fj)])
        return out
    except Exception:
        return None


def close_inland(land: np.ndarray, bbox: tuple, res: float = RES, seed: tuple = SEED, grow: int = 2) -> np.ndarray:
    """Chart land only reaches a few miles inland. Everything the open ocean can't reach without crossing land is
    land too (the whole interior). Land is thickened by `grow` cells only to close hairline gaps between chart
    sheets during the flood; the coastline itself stays exactly where the chart draws it."""
    from scipy import ndimage
    barrier = ndimage.binary_dilation(land, iterations=grow) if grow else land
    labels, _ = ndimage.label(~barrier)
    lon_min, lat_min = bbox[0], bbox[1]
    si = int((seed[1] - lat_min) / res)
    sj = int((seed[0] - lon_min) / res)
    water_id = labels[si, sj]
    if water_id == 0:
        return land
    unreached = (labels != water_id) & ~barrier
    return land | unreached


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
            log(f"landmask: using saved {key} ({m.land.mean():.0%} land)")
        elif http is not None:
            land, used = None, []
            try:                                         # 1. NOAA chart land (main source)
                polys = fetch_enc_land(bbox, http, log)
                land = rasterize(polys, bbox)
                used.append(f"NOAA chart land ({len(polys)} shapes)")
            except Exception as e:
                log(f"landmask: {str(e)[:200]}")
            try:                                         # 2. OpenStreetMap coastline (extra; only if it doesn't leak)
                lines = fetch_coastlines(bbox, http, log)
                osm = build(lines, bbox)
                if sane(osm):
                    land = osm.land if land is None else (land | osm.land)
                    used.append(f"OpenStreetMap ({len(lines)} coastline pieces)")
                else:
                    log(f"landmask: OpenStreetMap coastline skipped ({osm.land.mean():.0%} land — it has a gap)")
            except Exception as e:
                log(f"landmask: {str(e)[:200]}")
            if land is None:                             # last resort: the seafloor model's land everywhere (rougher)
                h = int(round((bbox[3] - bbox[1]) / RES)); w = int(round((bbox[2] - bbox[0]) / RES))
                land = bathy_land(store, region, (h, w), bbox, south_only=False)
                if land is not None:
                    used.append("seafloor model only (rough coastline)")
            if land is not None:
                south = bathy_land(store, region, land.shape, bbox)   # 3. Mexico from the seafloor model
                if south is not None:
                    land = land | south
                    used.append("seafloor model south of the border")
                land = close_inland(land, bbox)
                m = LandMask(bbox[0], bbox[1], RES, land)
                if sane(m):
                    store.put(key, m.to_bytes(), "application/octet-stream")
                    log(f"landmask: built {region} from {', '.join(used)} — {m.land.mean():.0%} land")
                else:
                    log(f"landmask: rejected ({m.land.mean():.0%} land); drawing without a mask")
                    m = None
            else:
                log("landmask: no land source worked; drawing without a mask")
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
