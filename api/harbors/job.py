"""python -m ocean.jobs harbors  — marinas, docks, piers, fuel docks, pump-outs, launch ramps and bait for SoCal.

Source: OpenStreetMap via the Overpass API (free). OpenStreetMap volunteers have mapped SoCal harbors in great detail
(individual docks in LA/Long Beach, Newport, Redondo, Marina del Rey, Dana Point, San Diego). Licence: ODbL — the
app must show "© OpenStreetMap contributors". Run weekly (with the rules job) and saved to R2 for offline use.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import httpx

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
# Point Conception to the Mexican border, coast only (south, west, north, east).
COAST_BBOX = (32.45, -120.75, 34.6, -117.05)


def query(bbox=COAST_BBOX) -> str:
    s, w, n, e = bbox
    b = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:240];
(
  nwr["leisure"="marina"]{b};
  way["man_made"="pier"]{b};
  node["man_made"="pier"]{b};
  nwr["leisure"="slipway"]{b};
  nwr["waterway"="fuel"]{b};
  nwr["amenity"="fuel"]["boat"="yes"]{b};
  nwr["seamark:small_craft_facility:category"]{b};
  nwr["seamark:type"="small_craft_facility"]{b};
  nwr["amenity"="sanitary_dump_station"]["boat"="yes"]{b};
  nwr["amenity"="sanitary_dump_station"]["vessel"="yes"]{b};
  nwr["name"~"pump.?out",i]{b};
  nwr["name"~"bait",i]["shop"!="supermarket"]{b};
  nwr["shop"="fishing"]{b};
  nwr["amenity"="harbourmaster"]{b};
  nwr["seamark:type"="harbour"]{b};
);
out tags geom;
"""


def classify(t: dict) -> str | None:
    """One kind per feature: the switch it belongs to in the app."""
    name = (t.get("name") or "").lower()
    craft = (t.get("seamark:small_craft_facility:category") or "").lower()
    if t.get("waterway") == "fuel" or (t.get("amenity") == "fuel" and t.get("boat") == "yes") or "fuel" in craft:
        return "fuel"
    if t.get("amenity") == "sanitary_dump_station" or "pump" in craft or re.search(r"pump.?out", name):
        return "pumpout"
    if "bait" in name or "bait" in craft:
        return "bait"
    if t.get("leisure") == "slipway" or "slipway" in craft or "boat_hoist" in craft:
        return "ramp"
    if t.get("shop") == "fishing":
        return "tackle"
    if t.get("amenity") == "harbourmaster" or t.get("seamark:type") == "harbour" or "harbour_master" in craft:
        return "harbor_office"
    if t.get("leisure") == "marina":
        return "marina"
    if t.get("man_made") == "pier":
        return "dock"
    if craft:
        return "service"
    return None


KEEP_TAGS = ("name", "operator", "phone", "contact:phone", "website", "contact:website", "opening_hours", "vhf",
             "seamark:radio_station:channel", "capacity", "fuel:diesel", "fuel:octane_87", "fuel:octane_89",
             "fuel:octane_91", "fuel:octane_93", "floating", "access", "fee", "description", "addr:street",
             "addr:housenumber", "addr:city", "ref", "seamark:small_craft_facility:category", "boat", "surface")


def summary(kind: str, t: dict) -> str:
    """One readable line for the info card."""
    bits = []
    labels = {"fuel": "Fuel dock", "pumpout": "Pump-out station", "bait": "Bait", "ramp": "Launch ramp",
              "tackle": "Tackle & bait shop", "harbor_office": "Harbor office", "marina": "Marina", "dock": "Dock / pier",
              "service": "Boater services"}
    bits.append(labels.get(kind, kind))
    fuels = [n for k, n in (("fuel:diesel", "diesel"), ("fuel:octane_87", "87"), ("fuel:octane_89", "89"),
                            ("fuel:octane_91", "91"), ("fuel:octane_93", "93")) if t.get(k) == "yes"]
    if fuels:
        bits.append("Fuel: " + ", ".join(fuels))
    if t.get("capacity"):
        bits.append(f"{t['capacity']} slips")
    vhf = t.get("vhf") or t.get("seamark:radio_station:channel")
    if vhf:
        bits.append(f"VHF {vhf}")
    if t.get("opening_hours"):
        bits.append(t["opening_hours"])
    phone = t.get("phone") or t.get("contact:phone")
    if phone:
        bits.append(phone)
    if t.get("floating") == "yes" and kind == "dock":
        bits.append("floating dock")
    if t.get("access") in ("private", "customers"):
        bits.append(f"access: {t['access']}")
    return " · ".join(bits)


def to_features(elements: list[dict]) -> list[dict]:
    feats, seen = [], set()
    for el in elements:
        t = el.get("tags") or {}
        kind = classify(t)
        if not kind:
            continue
        key = (el.get("type"), el.get("id"))
        if key in seen:
            continue
        seen.add(key)
        geom = None
        if el.get("type") == "node" and "lat" in el:
            geom = {"type": "Point", "coordinates": [round(el["lon"], 6), round(el["lat"], 6)]}
        elif el.get("type") == "way" and el.get("geometry"):
            pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"] if p]
            closed = len(pts) > 3 and pts[0] == pts[-1]
            if kind == "marina" and closed:
                geom = {"type": "Polygon", "coordinates": [pts]}
            elif len(pts) >= 2:
                geom = {"type": "LineString", "coordinates": pts}
        elif el.get("type") == "relation" and el.get("bounds"):
            b = el["bounds"]
            geom = {"type": "Point", "coordinates": [round((b["minlon"] + b["maxlon"]) / 2, 6), round((b["minlat"] + b["maxlat"]) / 2, 6)]}
        if not geom:
            continue
        props = {k: v for k, v in t.items() if k in KEEP_TAGS}
        props.update({"kind": kind, "id": f"osm-{el['type'][0]}{el['id']}", "summary": summary(kind, t)})
        feats.append({"type": "Feature", "geometry": geom, "properties": props})
        # Point markers for things drawn as shapes, so every marina / fuel dock / ramp also has a tappable dot.
        if geom["type"] != "Point" and kind != "dock":
            ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"]
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                          "properties": {**props, "id": props["id"] + "-pt", "center": True}})
    return feats


def extras() -> list[dict]:
    """Our own list (api/harbors/extras.json): places missing from both sources, mostly bait receivers.
    Only entries with a confirmed position are drawn."""
    import os
    p = os.path.join(os.path.dirname(__file__), "extras.json")
    try:
        items = json.load(open(p))
    except Exception:
        return []
    out = []
    for i, x in enumerate(items):
        if x.get("lat") is None or x.get("lon") is None:
            continue
        line = " · ".join(v for v in [x.get("summary"), x.get("phone"), f"VHF {x['vhf']}" if x.get("vhf") else None] if v)
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [x["lon"], x["lat"]]},
                    "properties": {"kind": x["kind"], "id": f"extra-{i}", "name": x["name"], "phone": x.get("phone"),
                                   "website": x.get("website"), "summary": line, "source": "Channel Nav"}})
    return out


def fetch(http: httpx.Client, log=print) -> list[dict]:
    q = query()
    last = None
    for url in OVERPASS:
        try:
            r = http.post(url, data={"data": q})
            r.raise_for_status()
            return r.json().get("elements", [])
        except Exception as e:
            last = e
            log(f"harbors: {url} failed ({str(e)[:150]})")
    raise RuntimeError(f"All OpenStreetMap servers failed: {last}")


def run(store, log=print) -> dict:
    http = httpx.Client(timeout=300, follow_redirects=True, headers={"User-Agent": "ChannelNav-fishing-app/1.0 (weekly harbor data job)"})
    try:
        osm = to_features(fetch(http, log))
    except Exception as e:   # OpenStreetMap down: still publish the official list
        log(f"harbors: OpenStreetMap failed ({str(e)[:150]})")
        osm = []
    from .dbw import fetch_all, merge
    try:
        official = fetch_all(log)
    except Exception as e:
        log(f"harbors: DBW failed ({str(e)[:150]})")
        official = []
    feats = merge(osm, official) + extras()
    counts: dict[str, int] = {}
    for f in feats:
        if not f["properties"].get("center"):
            counts[f["properties"]["kind"]] = counts.get(f["properties"]["kind"], 0) + 1
    if len(feats) < 50:
        raise RuntimeError(f"Only {len(feats)} harbor features came back; keeping the previous file.")
    key = "vectors/harbors/socal.geojson"
    store.put(key, json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")).encode(), "application/geo+json")
    manifest = {"layer": "harbors", "updated_at": datetime.now(timezone.utc).isoformat(), "url": store.url(key),
                "counts": counts, "source": "OpenStreetMap + California Division of Boating and Waterways",
                "attribution": ATTRIBUTION + " · California State Parks, Division of Boating and Waterways",
                "note": "Harbor details from OpenStreetMap volunteers. Check with the marina before you rely on hours or fuel."}
    store.put("manifests/harbors.json", json.dumps(manifest).encode(), "application/json")
    log("harbors: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return manifest
