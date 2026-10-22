"""Tap-anywhere conditions (spec §7, master spec 'USER SELECTS LOCATION -> APP EXPLAINS EVERYTHING').
Every provider runs in parallel; a slow or failing one never blanks the card."""
import asyncio
import json
import math
import time
from datetime import datetime, timezone

from core.geo import bearing, compass, distance_nm
from core.models import Measurement, Section
from core.storage import get_store
from ocean.breaks import describe_near
from ocean.grid import Grid
from ocean.registry import BREAKS, REGIONS, break_settings

from . import buoys, tides, weather
from .astro import moon_phase

_grid_cache: dict[str, tuple[float, Grid]] = {}


def _load_grid(key: str, ttl: float = 3600) -> Grid | None:
    hit = _grid_cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    raw = get_store().get(key)
    if raw is None:
        return None
    g = Grid.from_bytes(raw)
    _grid_cache[key] = (time.monotonic(), g)
    return g


def latest_grid(layer: str, day_offset: int = 0) -> tuple[Grid | None, dict | None]:
    raw = get_store().get(f"manifests/{layer}.json")
    if not raw:
        return None, None
    m = json.loads(raw)
    dates = m.get("dates", [])
    if len(dates) <= day_offset:
        return None, m
    return _load_grid(dates[day_offset]["grid"]), {**m, "entry": dates[day_offset]}


def _age_text(iso: str | None) -> str:
    if not iso:
        return "time unknown"
    h = (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds() / 3600
    return f"{int(h * 60)} min old" if h < 1 else f"{h:.0f} h old" if h < 36 else f"{h / 24:.0f} days old"


def _map_day(iso: str | None, today=None) -> str:
    """Satellite maps are labeled by the day they show (UTC date). Say which day, in plain words."""
    if not iso:
        return "date unknown"
    from datetime import date
    from zoneinfo import ZoneInfo
    d = date.fromisoformat(iso[:10])
    today = today or datetime.now(ZoneInfo("America/Los_Angeles")).date()
    n = (today - d).days
    when = "today" if n <= 0 else "yesterday" if n == 1 else f"{n} days ago"
    return f"map for {d.strftime('%b')} {d.day} · {when}"


def _water(lat: float, lon: float) -> Section:
    sec = Section()
    for layer, unit, fmt in (("sst", "°F", "{:.1f}°F"), ("chl", "mg/m³", "{:.2f} mg/m³")):
        g, m = latest_grid(layer)
        if g is None:
            sec.data[f"{layer}_missing"] = "Layer not processed yet"
            continue
        v = float(g.sample(lat, lon))
        obs = g.meta.get("observed_at")
        kind = g.meta.get("kind", "observed")
        name = "Water temp" if layer == "sst" else "Chlorophyll"
        if math.isfinite(v):
            sec.items.append(Measurement(
                type=layer, value=round(v, 2), unit=unit, kind=kind,
                label=f"{name} {fmt.format(v)} · {'satellite blend' if kind == 'interpolated' else 'satellite'}, {_map_day(obs)}",
                source=g.meta.get("source", ""), dataset=g.meta.get("dataset"),
                observed_at=datetime.fromisoformat(obs) if obs else None, resolution_m=g.meta.get("resolution_m")))
        else:
            sec.items.append(Measurement(type=layer, value=None, unit=unit, kind=kind, source=g.meta.get("source", ""),
                                         label=f"{name}: no satellite data here (cloud or coast)"))
        b = break_settings(layer, g.meta.get("resolution_m"))
        near = describe_near(g, lat, lon, 5.0, b["moderate"], b["strong"], log10=(layer == "chl"))
        if near:
            if layer == "sst":
                lbl = (f"{near['strength'].title()} temperature break {near['distance_nm']:.1f} NM {compass(near['bearing'])}: "
                       f"{near['from_value']:.1f}→{near['to_value']:.1f}°F ({near['change']:.1f}° over ~{near['width_nm'] or 0:.1f} NM)")
            else:
                lbl = f"{near['strength'].title()} green-to-blue edge {near['distance_nm']:.1f} NM {compass(near['bearing'])}: {near['from_value']:.2f}→{near['to_value']:.2f} mg/m³"
            sec.items.append(Measurement(type=f"{layer}_break", value=near["per_nm"], unit=f"{unit} per NM", kind="derived",
                                         label=lbl, source=g.meta.get("source", ""), dataset=g.meta.get("dataset"),
                                         observed_at=datetime.fromisoformat(obs) if obs else None, distance_nm=near["distance_nm"],
                                         extra=near))
    return sec


def _depth(lat: float, lon: float) -> Section:
    g, m = latest_grid("bathy")
    if g is None:
        return Section(ok=False, error="Seafloor layer not processed yet")
    v = float(g.sample(lat, lon))
    if not math.isfinite(v):
        return Section(items=[Measurement(type="depth", value=None, unit="ft", kind="static", source=g.meta.get("source", ""), label="Depth: no data (land or outside coverage)")])
    return Section(items=[Measurement(type="depth", value=round(v), unit="ft", kind="static", source=g.meta.get("source", ""),
                                      dataset=g.meta.get("dataset"), resolution_m=g.meta.get("resolution_m"),
                                      label=f"Depth ≈ {round(v, -1):,.0f} ft · seafloor model, not for navigation")])


async def _tide(lat, lon) -> Section:
    t = await tides.tide_at(lat, lon)
    st = t["station"]
    src = f"NOAA CO-OPS {st['id']} {st['name']}"
    items = []
    s = t["state"]
    if s["height_ft"] is not None:
        items.append(Measurement(type="tide_height", value=s["height_ft"], unit="ft", kind="prediction", source=src,
                                 distance_nm=t["distance_nm"], label=f"Tide {s['trend']} · {s['height_ft']:.1f} ft · station {t['distance_nm']} NM away"))
    for key, nm in (("next_high", "Next high"), ("next_low", "Next low")):
        p = t[key]
        if p:
            items.append(Measurement(type=key, value=p["v"], unit="ft", kind="prediction", source=src,
                                     forecast_for=datetime.fromisoformat(p["t"]), distance_nm=t["distance_nm"],
                                     label=f"{nm} {p['v']:.1f} ft"))
    return Section(items=items, data={"station": st, "distance_nm": t["distance_nm"], "curve": t["curve"], "hilo": t["hilo"], "trend": s["trend"]})


async def _weather(lat, lon) -> Section:
    w = await weather.weather_at(lat, lon)
    if not w:
        return Section(ok=False, error="Outside NWS forecast grids here — see buoy observations")
    src = f"National Weather Service ({w.get('office')})"
    upd = datetime.fromisoformat(w["updated"]) if w.get("updated") else None
    items = []
    if w.get("wind_kt") is not None:
        items.append(Measurement(type="wind", value=round(w["wind_kt"]), unit="kt", kind="forecast", source=src, forecast_for=datetime.now(timezone.utc),
                                 label=f"Wind {compass(w.get('wind_dir'))} {round(w['wind_kt'])} kt" + (f", gusts {round(w['gust_kt'])}" if w.get("gust_kt") else "") + " · forecast",
                                 extra={"dir": w.get("wind_dir"), "gust_kt": w.get("gust_kt"), "issued": w.get("updated")}))
    if w.get("wave_ft") is not None:
        items.append(Measurement(type="wave_forecast", value=w["wave_ft"], unit="ft", kind="forecast", source=src, label=f"Seas {w['wave_ft']:.0f} ft · forecast"))
    if w.get("air_f") is not None:
        items.append(Measurement(type="air_temp", value=round(w["air_f"]), unit="°F", kind="forecast", source=src, label=f"Air {round(w['air_f'])}°F"))
    if w.get("visibility_nm") is not None:
        items.append(Measurement(type="visibility", value=w["visibility_nm"], unit="NM", kind="forecast", source=src, label=f"Visibility {w['visibility_nm']} NM"))
    return Section(items=items, data={"wind_48h": w.get("wind_48h", []), "conditions": w.get("conditions"),
                                      "precip_chance": w.get("precip_chance"), "issued": upd.isoformat() if upd else None})


async def _buoy(lat, lon) -> Section:
    o = await buoys.nearest_observation(lat, lon, REGIONS["socal"])
    if not o:
        return Section(ok=False, error="No reporting buoy within 60 NM")
    st = o["station"]
    src = f"NOAA NDBC buoy {st['id']} {st.get('name') or ''}".strip()
    t = datetime.fromisoformat(o["observed_at"])
    items = []
    if o.get("wave_ft") is not None:
        per = f" @ {o['dominant_period_s']:.0f} s" if o.get("dominant_period_s") else ""
        items.append(Measurement(type="wave_observed", value=o["wave_ft"], unit="ft", kind="observed", source=src, observed_at=t, distance_nm=o["distance_nm"],
                                 label=f"Waves {o['wave_ft']:.1f} ft{per} {compass(o.get('wave_dir'))} · measured at buoy {o['distance_nm']} NM away"))
    if o.get("wind_kt") is not None:
        items.append(Measurement(type="wind_observed", value=o["wind_kt"], unit="kt", kind="observed", source=src, observed_at=t, distance_nm=o["distance_nm"],
                                 label=f"Buoy wind {compass(o.get('wind_dir'))} {o['wind_kt']:.0f} kt · measured"))
    if o.get("water_f") is not None:
        items.append(Measurement(type="buoy_water_temp", value=o["water_f"], unit="°F", kind="observed", source=src, observed_at=t, distance_nm=o["distance_nm"],
                                 label=f"Buoy water {o['water_f']:.1f}°F · measured"))
    return Section(items=items, data={"station": st})


async def _alerts(lat, lon) -> Section:
    a = await weather.alerts(lat, lon)
    return Section(data={"alerts": a}, items=[Measurement(type="alert", value=x["event"], kind="forecast", source="National Weather Service",
                                                          label=x.get("headline") or x["event"]) for x in a])


async def _nearby(lat, lon, pool) -> Section:
    if pool is None:
        return Section(ok=False, error="Database not configured")
    async with pool.connection() as conn:
        cur = await conn.execute(
            """select id::text, canonical_name, spot_type::text,
                      st_y(st_pointonsurface(geom::geometry)) lat, st_x(st_pointonsurface(geom::geometry)) lon,
                      st_distance(geom, st_makepoint(%(lon)s,%(lat)s)::geography)/1852.0 nm
               from fishing_spots where status='active' order by geom <-> st_makepoint(%(lon)s,%(lat)s)::geography limit 3""",
            {"lat": lat, "lon": lon})
        spots = await cur.fetchall()
        reports = None
        try:
            cur = await conn.execute(
                """select count(*) n from public_catches
                   where caught_at > now() - interval '24 hours'
                     and public_geom is not null
                     and st_dwithin(public_geom, st_makepoint(%(lon)s,%(lat)s)::geography, 5 * 1852)""", {"lat": lat, "lon": lon})
            reports = (await cur.fetchone())["n"]
        except Exception:
            pass  # Catch Map tables not created yet
    for s in spots:
        s["bearing"] = round(bearing(lat, lon, s["lat"], s["lon"]))
        s["nm"] = round(s["nm"], 1)
    label = None if reports is None else f"{reports} catch report{'s' if reports != 1 else ''} within 5 NM in the last 24 h"
    return Section(data={"spots": spots, "reports_24h_5nm": reports, "reports_label": label})


ALL_SECTIONS = ("water", "depth", "tide", "weather", "waves", "alerts", "nearby", "moon")


async def conditions(lat: float, lon: float, pool=None, fields: set[str] | None = None) -> dict:
    """fields limits the work, e.g. {'water','depth'} for the probe crosshair while dragging."""
    want = set(fields or ALL_SECTIONS)
    now = datetime.now(timezone.utc)
    out = {
        "lat": lat, "lon": lon, "generated_at": now.isoformat(),
        "disclaimer": "Fishing information only. Not for navigation. Satellite, model and buoy data can be delayed or incomplete.",
    }
    if "water" in want:
        out["water"] = _safe(_water, lat, lon)
    if "depth" in want:
        out["depth"] = _safe(_depth, lat, lon)
    if "moon" in want:
        out["moon"] = moon_phase(now)
    tasks = {"tide": lambda: _tide(lat, lon), "weather": lambda: _weather(lat, lon), "waves": lambda: _buoy(lat, lon),
             "alerts": lambda: _alerts(lat, lon), "nearby": lambda: _nearby(lat, lon, pool)}
    names = [n for n in tasks if n in want]
    results = await asyncio.gather(*[asyncio.wait_for(tasks[n](), timeout=15) for n in names], return_exceptions=True)
    friendly = {"tide": "Tide isn't available for this spot right now", "weather": "Weather isn't available right now — try again in a minute",
                "waves": "No buoy reading nearby right now", "alerts": "Couldn't check marine warnings right now", "nearby": "Nearby reports aren't available right now"}
    for n, r in zip(names, results):
        if isinstance(r, BaseException):
            print(f"conditions {n} failed: {type(r).__name__}: {str(r)[:200]}")   # full reason stays in the server log
            out[n] = Section(ok=False, error=friendly.get(n, "Not available right now"))
        else:
            out[n] = r
    return {k: (v.model_dump(mode="json") if isinstance(v, Section) else v) for k, v in out.items()}


def _safe(fn, *a) -> Section:
    try:
        return fn(*a)
    except Exception as e:
        print(f"conditions {getattr(fn, '__name__', '?')} failed: {type(e).__name__}: {str(e)[:200]}")
        return Section(ok=False, error="Not available here right now")
