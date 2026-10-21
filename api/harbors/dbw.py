"""California Division of Boating and Waterways (DBW) boating-facility directory: the state's official list of
marinas, fuel docks, launch ramps and pump-outs, each with map coordinates, address, phone and services.

Pages: https://dbw.parks.ca.gov/BoatingFacilities/County/<County>  (table of facilities with Type and Access)
       https://dbw.parks.ca.gov/BoatingFacilities/f/<id>           (one facility: address, phone, services, map pin)
Public California government information; we credit "California State Parks, Division of Boating and Waterways".
Only coastal facilities are kept (lakes and rivers inland are dropped). Polite: one request at a time, small pause.
"""
from __future__ import annotations

import html
import math
import re
import time

import httpx

BASE = "https://dbw.parks.ca.gov/BoatingFacilities"
COUNTIES = ["Santa Barbara", "Ventura", "Los Angeles", "Orange", "San Diego"]
CREDIT = "California State Parks, Division of Boating and Waterways"

# Coarse SoCal mainland coastline (lon, lat), Point Conception to the border, plus Catalina. A facility within
# 6 km of this line (or 15 km of a Catalina point) is coastal; Lake Elsinore, Castaic, Lake Murray etc. are not.
COAST = [(-120.47, 34.45), (-120.2, 34.47), (-119.85, 34.41), (-119.69, 34.40), (-119.52, 34.39), (-119.29, 34.27),
         (-119.23, 34.16), (-119.21, 34.15), (-119.06, 34.09), (-118.80, 34.03), (-118.50, 34.01), (-118.45, 33.97),
         (-118.43, 33.91), (-118.40, 33.84), (-118.42, 33.77), (-118.29, 33.71), (-118.27, 33.72), (-118.18, 33.75),
         (-118.12, 33.74), (-118.10, 33.73), (-118.00, 33.65), (-117.90, 33.60), (-117.87, 33.59), (-117.78, 33.54),
         (-117.70, 33.46), (-117.62, 33.42), (-117.55, 33.37), (-117.39, 33.20), (-117.35, 33.15), (-117.30, 33.04),
         (-117.27, 32.96), (-117.27, 32.85), (-117.25, 32.77), (-117.24, 32.67), (-117.17, 32.71), (-117.18, 32.68),
         (-117.10, 32.63), (-117.13, 32.58), (-117.12, 32.53)]
ISLANDS = [(-118.32, 33.34), (-118.50, 33.44)]   # Avalon, Two Harbors


def _km(lon1, lat1, lon2, lat2) -> float:
    x = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110.57
    return math.hypot(x, y)


def _seg_km(p, a, b) -> float:
    k = math.cos(math.radians(p[1]))
    ax, ay, bx, by, px, py = a[0] * k, a[1], b[0] * k, b[1], p[0] * k, p[1]
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return _km(p[0], p[1], (ax + t * dx) / k, ay + t * dy)


def is_coastal(lon: float, lat: float) -> bool:
    if any(_km(lon, lat, *i) <= 15 for i in ISLANDS):
        return True
    return min(_seg_km((lon, lat), COAST[i], COAST[i + 1]) for i in range(len(COAST) - 1)) <= 6


def _text(s: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def parse_county(page: str) -> list[dict]:
    """Rows of the county table: id, name, type, access."""
    out = []
    for row in re.split(r"<tr[\s>]", page, flags=re.I)[1:]:
        m = re.search(r'href="[^"]*/BoatingFacilities/f/(\d+)"[^>]*>(.*?)</a>', row, re.I | re.S)
        if not m:
            continue
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.I | re.S)]
        out.append({"id": m.group(1), "name": _text(m.group(2)), "type": cells[1] if len(cells) > 1 else "",
                    "access": cells[2] if len(cells) > 2 else ""})
    if not out:   # page layout changed: fall back to every facility link (type unknown, read from each page)
        seen = set()
        for fid, name in re.findall(r'/BoatingFacilities/f/(\d+)"[^>]*>(.*?)</a>', page, re.I | re.S):
            if fid not in seen:
                seen.add(fid)
                out.append({"id": fid, "name": _text(name), "type": "", "access": ""})
    return out


def parse_facility(page: str) -> dict:
    """Coordinates (from the map pin), address, phone and services of one facility page."""
    m = re.search(r"[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)", page)
    text = _text(page)
    phone = re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", text)
    addr = re.search(r"Facility Address:\s*(.+?)(?:Mailing Address:|Phone|Services|$)", text)
    svc_block = re.search(r"Services(.*?)(?:Environmental Services(.*?))?(?:Contact|Site Map|Back to|$)", text, re.S)
    services = (svc_block.group(1) + " " + (svc_block.group(2) or "")) if svc_block else text
    return {
        "lat": float(m.group(1)) if m else None, "lon": float(m.group(2)) if m else None,
        "phone": phone.group(0) if phone else None,
        "address": addr.group(1).strip()[:160] if addr else None,
        "services": services,
    }


def kinds_for(row: dict, fac: dict) -> list[str]:
    t = (row.get("type") or "").lower()
    s = (fac.get("services") or "").lower()
    n = (row.get("name") or "").lower()
    k = []
    if "fuel" in t or "fuel sales" in s or "fuel dock" in n:
        k.append("fuel")
    if "pump" in s or "pump" in t or "sewage" in s:
        k.append("pumpout")
    if "launch" in t or "launch ramp" in s or "ramp" in n:
        k.append("ramp")
    if "bait" in s or "bait" in n:
        k.append("bait")
    if "marina" in t and not k:
        k.append("marina")
    return k


def fetch_all(log=print, pause: float = 0.4) -> list[dict]:
    http = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "ChannelNav-fishing-app/1.0 (weekly harbor data job)"})
    feats = []
    for county in COUNTIES:
        try:
            rows = parse_county(http.get(f"{BASE}/County/{county.replace(' ', '%20')}").raise_for_status().text)
        except Exception as e:
            log(f"harbors dbw: {county} list failed ({str(e)[:120]})")
            continue
        kept = 0
        for row in rows:
            t = row["type"].lower()
            if t and not any(w in t for w in ("fuel", "launch", "marina", "pump")) and "bait" not in row["name"].lower():
                continue
            time.sleep(pause)
            try:
                fac = parse_facility(http.get(f"{BASE}/f/{row['id']}").raise_for_status().text)
            except Exception:
                continue
            if fac["lat"] is None or not is_coastal(fac["lon"], fac["lat"]):
                continue
            for kind in kinds_for(row, fac):
                summary = " · ".join(x for x in [{"fuel": "Fuel dock", "pumpout": "Pump-out station", "ramp": "Launch ramp",
                                                  "bait": "Bait", "marina": "Marina"}[kind], fac["phone"],
                                                 f"access: {row['access'].lower()}" if row["access"] else ""] if x)
                feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(fac["lon"], 6), round(fac["lat"], 6)]},
                              "properties": {"kind": kind, "id": f"dbw-{row['id']}-{kind}", "name": row["name"], "phone": fac["phone"],
                                             "addr:street": fac["address"], "summary": summary, "source": CREDIT,
                                             "website": f"{BASE}/f/{row['id']}"}})
                kept += 1
        log(f"harbors dbw: {county}: {kept} coastal features from {len(rows)} listed")
    return feats


def merge(osm: list[dict], dbw: list[dict], within_m: float = 150) -> list[dict]:
    """Official DBW points win; an OpenStreetMap point of the same kind within 150 m is treated as the same place."""
    out = list(dbw)
    pts = [(f["properties"]["kind"], f["geometry"]["coordinates"]) for f in dbw]
    for f in osm:
        g = f["geometry"]
        if g["type"] == "Point":
            k, (lon, lat) = f["properties"]["kind"], g["coordinates"]
            if any(k == k2 and _km(lon, lat, c[0], c[1]) * 1000 <= within_m for k2, c in pts):
                continue
        out.append(f)
    return out
