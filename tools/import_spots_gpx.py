"""Turn a fishing-spot GPX file into a SQL seed for the fishing_spots table.

Usage:
    python3 tools/import_spots_gpx.py San_Diego_Fishing_Spots.gpx > db/seeds/004_fishing_spots_swyc.sql

Keeps every real fishing spot with its exact coordinates from the file. Skips map-reference points that are not
fishing spots (tournament boundary corners, "Area 1.1" grid points, "50 miles from Point Loma" markers, the yacht
club building, MPA markers (MPAs come from CDFW) and FADs marked missing). Running the SQL again replaces the
earlier import from the same source, so it is safe to re-run after an update.
"""
from __future__ import annotations

import html
import re
import sys
import xml.etree.ElementTree as ET

SOURCE_NAME = "SWYC Anglers"
SOURCE_URL = "https://swycanglers.org/resources/local-offshore-fishing-spots/"
SOURCE_LICENSE = "Used with permission of SWYC Anglers"
NS = {"g": "http://www.topografix.com/GPX/1/1"}

# The GPX "desc" is either a category ("Fishing Spot", "Kelp", "Man-Made Reef") or an area name.
CATEGORY_DESCS = {"fishing spot", "swyc fishing spot", "google maps", "big area", "kelp", "rocky", "man-made reef", "wreck"}
ICON_TYPE = {"icon-2.png": "kelp", "icon-3.png": "reef", "icon-4.png": "reef", "icon-5.png": "wreck"}
ISLANDS = ("catalina", "san clemente island", "channel islands")


def skip(name: str, sym: str) -> bool:
    n = name.lower()
    return (
        sym.endswith(("503-wht-blank_maps.png", "1125-crisis-caution.png", "1197-fac-headquarters.png"))
        or n.startswith("[")
        or "(missing)" in n
    )


def spot_type(name: str, sym: str, area: str | None) -> str:
    if sym in ICON_TYPE:
        return ICON_TYPE[sym]
    n = name.lower()
    for words, t in (
        (("wreck", "yukon"), "wreck"),
        (("kelp",), "kelp"),
        (("canyon", "trench"), "canyon"),
        (("knoll", "seamount"), "knoll"),
        (("ridge", "finger", "knuckle", "curve"), "ridge"),
        (("bank",), "bank"),
        (("pipe", "rig", "tank", "tower", "buoy", "fad", "pier", "jetty"), "offshore_structure"),
        (("reef", "rock", "pinnacle", "hard bottom", "hardbottom"), "reef"),
        (("fathom", " fa "), "fathom_spot"),
    ):
        if any(w in n for w in words):
            return t
    if re.match(r"^[\d #/()\-–′'¼a-z]*\d", n) and re.match(r"^#?\d", n):
        return "fathom_spot"   # numbered high spots ("209", "267 (The Condom)") are named for their depth
    if area and area.lower().startswith(ISLANDS):
        return "island_feature"
    return "other"


def depth_ft(name: str) -> int | None:
    n = name.lower()
    m = re.search(r"(\d+)\s*(?:fathoms?|fa)\b", n)
    if m:
        return int(m.group(1)) * 6
    m = re.search(r"(\d+)\s*(?:ft|′|')", n)
    if m:
        return int(m.group(1))
    return None


def sql(s: str | None) -> str:
    return "null" if s is None else "'" + s.replace("'", "''") + "'"


def main(path: str) -> None:
    root = ET.parse(path).getroot()
    rows, seen = [], set()
    for w in root.findall("g:wpt", NS):
        lat, lon = float(w.get("lat")), float(w.get("lon"))
        name = html.unescape((w.findtext("g:name", "", NS) or "").strip())
        desc = html.unescape((w.findtext("g:desc", "", NS) or "").strip())
        sym = (w.findtext("g:sym", "", NS) or "").split("/")[-1]
        if not name or skip(name, sym):
            continue
        key = (name.lower(), round(lat, 4), round(lon, 4))
        if key in seen:
            continue
        seen.add(key)
        area = desc if desc and desc.lower() not in CATEGORY_DESCS and not re.match(r"^[\d.]+ x ", desc) and not desc.lower().startswith("stay ") else None
        note = desc if desc and (re.match(r"^[\d.]+ x ", desc) or desc.lower().startswith("stay ") or desc.lower() == "big area") else None
        rows.append((name, lat, lon, area, spot_type(name, sym, area), depth_ft(name), note))

    print("-- Fishing spots imported from the SWYC Anglers GPX (tools/import_spots_gpx.py). Safe to re-run.")
    print("begin;")
    print(f"delete from fishing_spots where source_name = {sql(SOURCE_NAME)} or source_name = 'Developer placeholder';")
    print("insert into fishing_spots (canonical_name, geom, region, subregion, spot_type, depth_ft, description,")
    print("  source_name, source_url, source_license, source_last_verified, coordinate_confidence, status) values")
    vals = [
        f"  ({sql(n)}, st_setsrid(st_makepoint({lon}, {lat}), 4326)::geography, 'socal', {sql(a)}, '{t}', "
        f"{'null' if d is None else d}, {sql(note)}, {sql(SOURCE_NAME)}, {sql(SOURCE_URL)}, {sql(SOURCE_LICENSE)}, "
        f"current_date, 'medium', 'active')"
        for n, lat, lon, a, t, d, note in rows
    ]
    print(",\n".join(vals) + ";")
    print("commit;")
    print(f"-- {len(rows)} spots", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
