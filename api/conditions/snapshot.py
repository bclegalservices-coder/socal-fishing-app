"""Conditions AT THE TIME of a catch (spec §32, §14). Used for every catch, including ones logged
offline and sent hours later: water temp and chlorophyll come from that day's satellite image,
the tide from NOAA predictions for that minute, the moon for that night. Live wind/waves are only
attached when the catch is recent enough for them to be meaningful."""
import json
import math
from datetime import datetime, timedelta, timezone

from core.storage import get_store
from ocean.breaks import gradient_per_nm

from . import buoys, tides, weather
from .astro import moon_phase
from .service import _load_grid
from ocean.registry import REGIONS


def grid_for_day(layer: str, day: str):
    """The newest processed image on or before `day` (YYYY-MM-DD), within 3 days."""
    raw = get_store().get(f"manifests/{layer}.json")
    if not raw:
        return None
    dates = json.loads(raw).get("dates", [])
    best = None
    for d in dates:  # newest first
        if d["date"] <= day:
            best = d
            break
    if not best:
        return None
    if (datetime.fromisoformat(day) - datetime.fromisoformat(best["date"])).days > 3:
        return None
    return _load_grid(best["grid"])


def _val(g, lat, lon):
    if g is None:
        return None
    v = float(g.sample(lat, lon))
    return round(v, 3) if math.isfinite(v) else None


def _grad(g, lat, lon, log10=False):
    if g is None:
        return None
    _, mag = gradient_per_nm(g, 1.0, log10)
    from ocean.grid import Grid
    v = float(Grid(g.lats, g.lons, mag.astype("float32")).sample(lat, lon))
    return round(v, 3) if math.isfinite(v) else None


async def snapshot(lat: float, lon: float, at: datetime) -> dict:
    at = at.astimezone(timezone.utc)
    day = at.date().isoformat()
    sst = grid_for_day("sst", day)
    chl = grid_for_day("chl", day)
    bathy_raw = get_store().get("manifests/bathy.json")
    bathy = _load_grid(json.loads(bathy_raw)["dates"][0]["grid"]) if bathy_raw else None
    raw: dict = {"lat": lat, "lon": lon, "at": at.isoformat()}
    out = {
        "captured_at": at.isoformat(),
        "sst_f": _val(sst, lat, lon), "sst_gradient_f_per_nm": _grad(sst, lat, lon),
        "sst_observed_at": sst.meta.get("observed_at") if sst else None, "sst_source": sst.meta.get("source") if sst else None,
        "sst_interpolated": (sst.meta.get("kind") == "interpolated") if sst else None,
        "chl_mg_m3": _val(chl, lat, lon),
        "chl_observed_at": chl.meta.get("observed_at") if chl else None, "chl_source": chl.meta.get("source") if chl else None,
        "chl_interpolated": (chl.meta.get("kind") == "interpolated") if chl else None,
        "depth_ft": _val(bathy, lat, lon), "depth_source": bathy.meta.get("source") if bathy else None,
        "moon_phase": moon_phase(at)["phase"],
    }
    try:
        t = await tides.tide_at(lat, lon, now=at)
        out.update({"tide_stage": t["state"]["trend"], "tide_height_ft": t["state"]["height_ft"],
                    "tide_station": f"{t['station']['id']} {t['station']['name']}", "tide_station_nm": t["distance_nm"]})
    except Exception as e:
        raw["tide_error"] = str(e)[:200]
    if abs((datetime.now(timezone.utc) - at).total_seconds()) < 2 * 3600:   # only "now" data for recent catches
        try:
            w = await weather.weather_at(lat, lon)
            if w:
                out.update({"wind_kt": w.get("wind_kt"), "wind_dir_deg": w.get("wind_dir"), "gust_kt": w.get("gust_kt"),
                            "wind_source": f"National Weather Service {w.get('office')}", "wind_is_forecast": True,
                            "air_temp_f": w.get("air_f"), "weather": w.get("conditions")})
        except Exception as e:
            raw["weather_error"] = str(e)[:200]
        try:
            o = await buoys.nearest_observation(lat, lon, REGIONS["socal"])
            if o:
                out.update({"swell_ft": o.get("wave_ft"), "swell_period_s": o.get("dominant_period_s"), "swell_dir_deg": o.get("wave_dir"),
                            "swell_source": f"NOAA NDBC {o['station']['id']} ({o['distance_nm']} NM)"})
                if out.get("wind_kt") is None and o.get("wind_kt") is not None:
                    out.update({"wind_kt": o["wind_kt"], "wind_dir_deg": o.get("wind_dir"), "gust_kt": o.get("gust_kt"),
                                "wind_source": f"NOAA NDBC {o['station']['id']} (measured)", "wind_is_forecast": False})
        except Exception as e:
            raw["buoy_error"] = str(e)[:200]
    else:
        raw["note"] = "Logged later: live wind/waves not attached (only data valid for the catch time is stored)."
    out["raw"] = raw
    return out
