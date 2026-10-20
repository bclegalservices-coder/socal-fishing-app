"""Download features from ArcGIS REST layers as GeoJSON, clipped to a box, with paging."""
import re

import httpx


def query_layer(http: httpx.Client, layer_url: str, bbox: tuple, page: int = 1000, max_features: int = 20000) -> list[dict]:
    lon_min, lat_min, lon_max, lat_max = bbox
    feats: list[dict] = []
    offset = 0
    while len(feats) < max_features:
        r = http.get(f"{layer_url.rstrip('/')}/query", params={
            "where": "1=1", "geometry": f"{lon_min},{lat_min},{lon_max},{lat_max}", "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson",
            "resultOffset": offset, "resultRecordCount": page,
        })
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"ArcGIS error: {j['error']}")
        batch = j.get("features", [])
        feats.extend(batch)
        more = (j.get("properties") or {}).get("exceededTransferLimit") or j.get("exceededTransferLimit")
        if not batch or (not more and len(batch) < page):
            break
        offset += len(batch)
    return feats


def find_layers(http: httpx.Client, service_url: str, patterns: list[str]) -> list[tuple[str, str]]:
    """(layer_url, layer_name) for every layer in a MapServer/FeatureServer whose name matches a pattern."""
    r = http.get(service_url.rstrip("/"), params={"f": "json"})
    r.raise_for_status()
    j = r.json()
    out = []
    for lyr in j.get("layers", []):
        nm = str(lyr.get("name", ""))
        if lyr.get("subLayerIds"):   # group layer
            continue
        if any(re.search(p, nm, re.I) for p in patterns):
            out.append((f"{service_url.rstrip('/')}/{lyr['id']}", nm))
    return out
