"""Rules & hazards layers (plan: 'Regulation and hazard layers'): MPAs, federal closures, wrecks,
navigation buoys, shipping lanes, anchorages, cable areas.

Sources are ArcGIS REST services. Each entry can be overridden by env var. Instead of hard-coding
layer numbers (which change), ENC layers are found by NAME inside the service.
VERIFY every source before launch (spec §63); the job reports exactly what it found.
"""
import os
import re

CDFW_MPA = os.environ.get(
    "MPA_URL",
    # CDFW 'California Marine Protected Areas' (ds582) feature service. Verify on data.ca.gov / CDFW BIOS.
    "https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds582_fpu/FeatureServer/0",
)
ENC_SERVICE = os.environ.get("ENC_SERVICE_URL", "https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer")
CLOSURES_URL = os.environ.get("CLOSURES_URL", "")   # NOAA Fisheries: Cowcod Conservation Areas / RCA lines (GeoJSON or ArcGIS layer)
MEXICO_MPA_URL = os.environ.get("MEXICO_MPA_URL", "")  # CONANP, where official boundaries are published

REGS_LINK = "https://wildlife.ca.gov/Conservation/Marine/MPAs"

# kind -> how it is drawn and what the alert does
RULE_LAYERS = [
    {"key": "mpa", "label": "Marine protected areas (California)", "kind": "mpa", "url": CDFW_MPA,
     "source": "California Department of Fish and Wildlife", "regs": REGS_LINK},
    {"key": "closures", "label": "Federal fishing closures", "kind": "closure", "url": CLOSURES_URL,
     "source": "NOAA Fisheries / Pacific Fishery Management Council", "regs": "https://www.fisheries.noaa.gov/west-coast"},
    {"key": "mpa_mx", "label": "Mexican protected areas", "kind": "mpa", "url": MEXICO_MPA_URL,
     "source": "CONANP (Mexico)", "regs": "https://www.gob.mx/conanp"},
    {"key": "wrecks", "label": "Wrecks & obstructions", "kind": "wreck", "service": ENC_SERVICE, "match": [r"wreck", r"obstruction"],
     "source": "NOAA Office of Coast Survey (ENC)"},
    {"key": "navaids", "label": "Navigation buoys & lights", "kind": "navaid", "service": ENC_SERVICE, "match": [r"buoy", r"\blight"],
     "source": "NOAA Office of Coast Survey (ENC)"},
    {"key": "lanes", "label": "Shipping lanes & traffic separation", "kind": "lane", "service": ENC_SERVICE,
     "match": [r"traffic separation", r"fairway", r"recommended track", r"precautionary"], "source": "NOAA Office of Coast Survey (ENC)"},
    {"key": "anchorages", "label": "Anchorages & cable areas", "kind": "area", "service": ENC_SERVICE,
     "match": [r"anchorage", r"cable area", r"pipeline area"], "source": "NOAA Office of Coast Survey (ENC)"},
]

_NAME_FIELDS = ("NAME", "Name", "name", "SHORTNAME", "FULLNAME", "OBJNAM", "objnam", "Area_Name", "NAME_LONG")
_TYPE_FIELDS = ("Type", "TYPE", "type", "MPA_TYPE", "Designation", "DESIG")


def _first(props: dict, keys) -> str | None:
    for k in keys:
        v = props.get(k)
        if v not in (None, "", " "):
            return str(v).strip()
    return None


def classify_mpa(name: str | None, mpa_type: str | None) -> dict:
    """California designations: SMR = State Marine Reserve (no take). SMCA = Conservation Area (limited take,
    some are 'No-Take'). SMP / SMRMA / SMCA(No-Take) handled too. Unknown -> 'check regulations'."""
    text = f"{mpa_type or ''} {name or ''}".upper()
    if "NO-TAKE" in text or "NO TAKE" in text or re.search(r"\bSMR\b", text) or "MARINE RESERVE" in text:
        return {"take": "no_take", "rule": "No take — no fishing of any kind."}
    if re.search(r"\bSMCA\b", text) or "CONSERVATION AREA" in text:
        return {"take": "limited", "rule": "Limited take — only some species or methods allowed. Check the regulations."}
    if re.search(r"\bSMP\b|\bSMRMA\b|MARINE PARK|RECREATIONAL MANAGEMENT", text):
        return {"take": "limited", "rule": "Special rules apply. Check the regulations."}
    return {"take": "unknown", "rule": "Protected area — check the regulations before fishing."}


def normalize(layer: dict, feature: dict) -> dict | None:
    props = feature.get("properties") or {}
    geom = feature.get("geometry")
    if not geom:
        return None
    name = _first(props, _NAME_FIELDS)
    out = {"layer": layer["key"], "kind": layer["kind"], "name": name, "source": layer["source"]}
    if layer["kind"] in ("mpa", "closure"):
        typ = _first(props, _TYPE_FIELDS)
        cls = classify_mpa(name, typ) if layer["kind"] == "mpa" else {"take": "limited", "rule": "Federal closure — check depth limits and seasons."}
        out.update({"type": typ, **cls, "regs": layer.get("regs")})
    elif layer["kind"] == "wreck":
        valsou = props.get("VALSOU") or props.get("valsou")
        try:
            out["depth_over_ft"] = round(float(valsou) * 3.28084) if valsou not in (None, "") else None
        except (TypeError, ValueError):
            out["depth_over_ft"] = None
        out["sub"] = (props.get("_layer_name") or "Wreck").replace("_", " ")
    else:
        out["sub"] = (props.get("_layer_name") or layer["label"]).replace("_", " ")
    return {"type": "Feature", "geometry": _round_geom(geom), "properties": out}


def _round_geom(g: dict, nd: int = 5) -> dict:
    def r(c):
        if isinstance(c, (int, float)):
            return round(c, nd)
        return [r(x) for x in c]
    return {"type": g["type"], "coordinates": r(g["coordinates"])} if "coordinates" in g else g
