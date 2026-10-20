"""SoCal Fishing Today (plan: 'Daily dashboard'). Built only from PUBLIC reports, and an area or
activity summary is shown only when at least 3 different anglers contributed — so no single
person's spot can be worked out from it."""
import asyncio
import json
import time

import numpy as np

from conditions import buoys, weather
from core.storage import get_store
from conditions.service import _load_grid
from ocean.registry import REGIONS

MIN_ANGLERS = 3
POINTS = {  # representative areas for warnings and buoy summary
    "Santa Monica Bay": (33.90, -118.60), "San Pedro Channel": (33.55, -118.25),
    "Catalina": (33.35, -118.40), "Offshore San Diego": (32.70, -117.45),
}
_cache: dict = {}

SPECIES_SQL = """
select species_code, count(*) reports, coalesce(sum(quantity), 0) fish
from public_catches where caught_at > now() - interval '24 hours'
group by 1 order by 3 desc"""

AREAS_SQL = """
select area, count(*) reports, sum(fish) fish, count(distinct uid) anglers, array_agg(distinct sp) species from (
  select coalesce(pc.area_name, near.canonical_name) area, pc.quantity fish, c.user_id uid, pc.species_code sp
  from public_catches pc join catch_reports c on c.id = pc.id
  left join lateral (
    select f.canonical_name from fishing_spots f
    where f.status = 'active' and pc.public_geom is not null and st_dwithin(f.geom, pc.public_geom, 5 * 1852)
    order by f.geom <-> pc.public_geom limit 1) near on true
  where pc.caught_at > now() - interval '24 hours') x
where area is not null
group by area having count(distinct uid) >= %(k)s
order by fish desc limit 5"""

ACTIVITY_SQL = """
select pc.species_code, count(*) n, count(distinct c.user_id) anglers,
  percentile_cont(0.25) within group (order by pc.sst_f) sst25, percentile_cont(0.75) within group (order by pc.sst_f) sst75,
  percentile_cont(0.25) within group (order by pc.chl_mg_m3) chl25, percentile_cont(0.75) within group (order by pc.chl_mg_m3) chl75,
  (select array_agg(t) from (select coalesce(p2.technique, p2.bait) t from public_catches p2
     where p2.species_code = pc.species_code and p2.caught_at > now() - interval '48 hours' and coalesce(p2.technique, p2.bait) is not null
     group by 1 order by count(*) desc limit 3) z) top
from public_catches pc join catch_reports c on c.id = pc.id
where pc.caught_at > now() - interval '48 hours'
group by 1 having count(*) >= 5 and count(distinct c.user_id) >= %(k)s
order by n desc limit 4"""

ANNOUNCE_SQL = "select title, body, link from announcements where active and now() between starts_at and coalesce(ends_at, 'infinity') order by starts_at desc limit 3"


def water_summary() -> dict | None:
    raw = get_store().get("manifests/sst.json")
    if not raw:
        return None
    m = json.loads(raw)
    if not m.get("dates"):
        return None
    d = m["dates"][0]
    g = _load_grid(d["grid"])
    if g is None:
        return None
    v = g.values[np.isfinite(g.values)]
    breaks = 0
    br = get_store().get(f"vectors/sst-breaks/{d.get('region', 'socal')}/{d['date']}.geojson")
    if br:
        breaks = sum(1 for f in json.loads(br)["features"] if f["properties"]["strength"] == "strong")
    return {"date": d["date"], "observed_at": d.get("observed_at"), "min_f": round(float(np.percentile(v, 5)), 1) if v.size else None,
            "max_f": round(float(np.percentile(v, 95)), 1) if v.size else None, "strong_break_lines": breaks, "kind": m.get("kind")}


async def build(pool) -> dict:
    hit = _cache.get("today")
    if hit and time.monotonic() - hit[0] < 600:
        return hit[1]
    out: dict = {"region": "Southern California", "min_anglers": MIN_ANGLERS}
    if pool is not None:
        async with pool.connection() as conn:
            try:
                out["species"] = await (await conn.execute(SPECIES_SQL)).fetchall()
                out["hot_areas"] = await (await conn.execute(AREAS_SQL, {"k": MIN_ANGLERS})).fetchall()
                out["activity"] = await (await conn.execute(ACTIVITY_SQL, {"k": MIN_ANGLERS})).fetchall()
            except Exception as e:
                out["catch_error"] = str(e)[:200]
            try:
                out["announcements"] = await (await conn.execute(ANNOUNCE_SQL)).fetchall()
            except Exception:
                out["announcements"] = []
    out["water"] = water_summary()

    async def warn(name, p):
        try:
            return [(name, a) for a in await weather.alerts(*p)]
        except Exception:
            return []

    async def buoy(name, p):
        try:
            o = await buoys.nearest_observation(p[0], p[1], REGIONS["socal"], max_nm=30)
            return {"area": name, **o} if o else None
        except Exception:
            return None

    w = await asyncio.gather(*[warn(n, p) for n, p in POINTS.items()])
    seen, warnings = set(), []
    for lst in w:
        for area, a in lst:
            k = (a["event"], a.get("ends"))
            if k not in seen:
                seen.add(k)
                warnings.append({**a, "near": area})
    out["warnings"] = warnings
    out["buoys"] = [b for b in await asyncio.gather(*[buoy(n, p) for n, p in POINTS.items()]) if b]
    _cache["today"] = (time.monotonic(), out)
    return out
