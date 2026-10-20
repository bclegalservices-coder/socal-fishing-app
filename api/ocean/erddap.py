"""Minimal ERDDAP griddap client: ask only for the box and day we need (spec §10, §47)."""
from __future__ import annotations
from datetime import date, datetime, timezone

import httpx
import numpy as np

from .grid import Grid
from .registry import GridDataset


def _range(lo: float, hi: float, stride: int, descending: bool) -> str:
    a, b = (hi, lo) if descending else (lo, hi)
    return f"[({a}):{stride}:({b})]"


def build_url(ds: GridDataset, bbox: tuple, when: str | date | None = "last", stride: int = 1, lat_desc: bool = False) -> str:
    lon_min, lat_min, lon_max, lat_max = bbox
    parts = []
    for d in ds.dims:
        if d == "time":
            if when in (None, "last"):
                parts.append("[(last)]")
            elif isinstance(when, str) and when.startswith("last-"):
                parts.append(f"[{when}]")
            else:
                iso = when.isoformat() if isinstance(when, date) else str(when)
                if len(iso) == 10:
                    iso += "T12:00:00Z"
                parts.append(f"[({iso})]")
        elif d == "latitude":
            parts.append(_range(lat_min, lat_max, stride, lat_desc))
        elif d == "longitude":
            parts.append(_range(lon_min, lon_max, stride, False))
        else:
            parts.append(f"[({ds.fixed.get(d, 0.0)})]")
    return f"{ds.erddap.rstrip('/')}/griddap/{ds.dataset_id}.json?{ds.variable}{''.join(parts)}"


def parse_table(payload: dict, variable: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, datetime | None]:
    """ERDDAP .json table -> (lats asc, lons asc, values[lat, lon], time)."""
    t = payload["table"]
    cols = t["columnNames"]
    rows = t["rows"]
    ilat, ilon, ival = cols.index("latitude"), cols.index("longitude"), cols.index(variable)
    itime = cols.index("time") if "time" in cols else None
    lats = np.array(sorted({r[ilat] for r in rows}), dtype=np.float64)
    lons = np.array(sorted({r[ilon] for r in rows}), dtype=np.float64)
    vals = np.full((lats.size, lons.size), np.nan, dtype=np.float32)
    lat_idx = {v: i for i, v in enumerate(lats)}
    lon_idx = {v: i for i, v in enumerate(lons)}
    for r in rows:
        v = r[ival]
        if v is not None:
            vals[lat_idx[r[ilat]], lon_idx[r[ilon]]] = v
    when = None
    if itime is not None and rows:
        when = datetime.fromisoformat(rows[0][itime].replace("Z", "+00:00")).astimezone(timezone.utc)
    return lats, lons, vals, when


def fetch_grid(ds: GridDataset, bbox: tuple, when="last", stride: int = 1, http: httpx.Client | None = None) -> Grid:
    http = http or httpx.Client(timeout=120, follow_redirects=True)
    last_err = None
    for lat_desc in (False, True):  # some datasets store latitude north-to-south
        url = build_url(ds, bbox, when, stride, lat_desc)
        r = http.get(url)
        if r.status_code == 200:
            lats, lons, vals, t = parse_table(r.json(), ds.variable)
            return Grid(lats, lons, vals, {
                "layer": ds.key, "dataset": ds.dataset_id, "source": ds.source, "units": ds.units,
                "kind": ds.kind, "resolution_m": ds.resolution_m, "verified": ds.verified,
                "observed_at": t.isoformat() if t else None, "url": url,
            })
        last_err = f"HTTP {r.status_code}: {r.text[:300]}"
    raise RuntimeError(
        f"ERDDAP request failed for {ds.dataset_id} ({last_err}). The dataset ID or variable may have changed; "
        f"run `python -m ocean.jobs discover` and set the {ds.key.upper()}_DATASET / _VARIABLE environment variables."
    )


def search(erddap: str, words: str, http: httpx.Client | None = None, limit: int = 25) -> list[dict]:
    http = http or httpx.Client(timeout=60, follow_redirects=True)
    r = http.get(f"{erddap.rstrip('/')}/search/index.json", params={"searchFor": words, "page": 1, "itemsPerPage": limit})
    r.raise_for_status()
    t = r.json()["table"]
    cols = t["columnNames"]
    out = []
    for row in t["rows"]:
        rec = dict(zip(cols, row))
        if rec.get("griddap"):
            out.append({"id": rec.get("Dataset ID"), "title": rec.get("Title"), "griddap": rec.get("griddap")})
    return out



def list_datasets(erddap: str, title_regex: str, http: httpx.Client | None = None) -> list[dict]:
    """Every gridded dataset whose title matches, newest data first, from ERDDAP's own catalog table
    (much lighter for the server than a full-text search, which often times out)."""
    import csv
    import io as _io
    from urllib.parse import quote
    http = http or httpx.Client(timeout=90, follow_redirects=True)
    url = (f"{erddap.rstrip('/')}/tabledap/allDatasets.csv?datasetID%2Ctitle%2CmaxTime"
           f"&dataStructure=%22grid%22&title=~%22{quote(title_regex, safe='')}%22")
    r = http.get(url)
    r.raise_for_status()
    rows = list(csv.reader(_io.StringIO(r.text)))[2:]   # skip the header and units rows
    out = [{"id": row[0], "title": row[1], "max_time": row[2] if len(row) > 2 else ""} for row in rows if row and row[0]]
    return sorted(out, key=lambda x: x["max_time"] or "", reverse=True)
