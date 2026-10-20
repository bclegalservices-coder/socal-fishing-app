"""NWS marine zone text forecast (the official 'Coastal Waters Forecast' a captain reads),
for the zone containing a point.  e.g. PZZ655 'Inner waters from Point Mugu to San Mateo Pt.'"""
from __future__ import annotations

import re

from core.http import cached, client

NWS = "https://api.weather.gov"
_PERIOD = re.compile(r"^\.([A-Z][A-Z ]+?)\.\.\.(.*)$")


def parse_ugc(line: str) -> list[str]:
    """'PZZ650-655-101000-' -> ['PZZ650','PZZ655'];  'PZZ670>673-' expands the range."""
    out, prefix = [], None
    for tok in line.strip().strip("-").split("-"):
        m = re.fullmatch(r"([A-Z]{2}[ZC])?(\d{3})(?:>(\d{3}))?", tok)
        if not m:
            continue  # the trailing ddhhmm expiration
        if m.group(1):
            prefix = m.group(1)
        if not prefix:
            continue
        a = int(m.group(2))
        b = int(m.group(3)) if m.group(3) else a
        out.extend(f"{prefix}{n:03d}" for n in range(a, b + 1))
    return out


def parse_cwf(text: str, zone: str) -> dict | None:
    """The section of a CWF product for one zone -> name, headlines and forecast periods."""
    for sec in text.split("$$"):
        lines = [l.rstrip() for l in sec.strip().splitlines()]
        idx = next((i for i, l in enumerate(lines) if re.match(r"^[A-Z]{2}Z\d{3}[->]", l)), None)
        if idx is None:
            continue
        ugc_lines, j = [], idx
        while j < len(lines) and re.match(r"^[A-Z0-9>-]+$", lines[j]) and lines[j].endswith("-"):
            ugc_lines.append(lines[j]); j += 1
        if zone not in parse_ugc("".join(ugc_lines)):
            continue
        name, k = [], j
        while k < len(lines) and lines[k] and not re.match(r"^\d{3,4} [AP]M ", lines[k]):
            name.append(lines[k]); k += 1
        issued = lines[k] if k < len(lines) else None
        body = "\n".join(lines[k + 1:])
        headlines = [h.strip(". ").capitalize() for h in re.findall(r"^\.\.\.(.+?)\.\.\.$", body, re.M)]
        periods, cur = [], None
        for l in body.splitlines():
            m = _PERIOD.match(l)
            if m:
                cur = {"name": m.group(1).title(), "text": m.group(2).strip()}
                periods.append(cur)
            elif cur and l.strip():
                cur["text"] += " " + l.strip()
        return {"zone": zone, "name": " ".join(name).strip(" -"), "issued": issued,
                "headlines": headlines, "periods": periods}
    return None


@cached(24 * 3600)
async def zone_for(lat: float, lon: float) -> dict | None:
    for kind in ("coastal", "offshore"):
        r = await client().get(f"{NWS}/zones", params={"type": kind, "point": f"{lat:.4f},{lon:.4f}"})
        if r.status_code != 200:
            continue
        feats = r.json().get("features") or []
        if feats:
            p = feats[0]["properties"]
            cwa = p.get("cwa") or []
            return {"id": p.get("id"), "name": p.get("name"), "kind": kind, "office": cwa[0] if cwa else None}
    return None


@cached(30 * 60)
async def latest_product(ptype: str, office: str) -> str | None:
    r = await client().get(f"{NWS}/products/types/{ptype}/locations/{office}")
    if r.status_code != 200:
        return None
    graph = r.json().get("@graph") or []
    if not graph:
        return None
    p = await client().get(f"{NWS}/products/{graph[0]['id']}")
    p.raise_for_status()
    return p.json().get("productText")


async def zone_forecast(lat: float, lon: float) -> dict | None:
    z = await zone_for(round(lat, 3), round(lon, 3))
    if not z or not z.get("office"):
        return None
    text = await latest_product("CWF" if z["kind"] == "coastal" else "OFF", z["office"])
    parsed = parse_cwf(text, z["id"]) if text else None
    return parsed or {"zone": z["id"], "name": z["name"], "periods": [], "headlines": []}
