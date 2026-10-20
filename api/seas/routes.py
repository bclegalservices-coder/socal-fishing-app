"""Weather page endpoints."""
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from conditions import buoys, tides
from ocean.registry import REGIONS
from seas import forecast as fc, zone
from seas.rating import BOAT_TYPES, COMFORT

router = APIRouter()
DISCLAIMER = ("Boat ratings are planning guidance, not a guarantee. Conditions change fast and local effects "
              "(points, harbor entrances, current against swell) can be worse. NWS warnings and your own judgment "
              "come first — if in doubt, don't go out.")


async def _safe(coro):
    try:
        return await coro
    except Exception:
        return None


@router.get("/weather/boats")
async def boats():
    """Boat types and comfort levels for the 'My boat' picker."""
    return {"types": [{"key": k, "label": v["label"], "typical_len": v["typical_len"],
                       "seas_ft": v["seas_ft"], "wind_kt": v["wind_kt"]} for k, v in BOAT_TYPES.items()],
            "comfort": list(COMFORT), "disclaimer": DISCLAIMER}


@router.get("/weather")
async def weather_page(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                       days: int = Query(5, ge=1, le=7), boat_type: str | None = None,
                       boat_len: float | None = Query(None, ge=6, le=120), comfort: str | None = None,
                       course: float | None = Query(None, ge=0, lt=360)):
    """Hourly + daily forecast (up to 5-7 days) with a 'Can my boat handle it?' rating on every hour,
    NWS alerts, the marine zone text forecast, nearest buoy right now, and today's tide."""
    boat = fc.boat_from_query(boat_type, boat_len, comfort, course)
    f, z, b, t = await asyncio.gather(
        _safe(fc.forecast(lat, lon, boat, days)), _safe(zone.zone_forecast(lat, lon)),
        _safe(buoys.nearest_observation(lat, lon, REGIONS["socal"], max_nm=80)), _safe(tides.tide_at(lat, lon)))
    if f is None and z is None and b is None:
        raise HTTPException(502, "Weather sources are not responding — try again in a minute.")
    return {"lat": lat, "lon": lon, "boat": boat, "forecast": f or {"available": False},
            "zone": z, "buoy_now": b, "tide": t, "disclaimer": DISCLAIMER}


@router.get("/weather/history")
async def weather_history(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                          days: int = Query(7, ge=1, le=45), station: str | None = None):
    """MEASURED buoy history (wind, waves, period, water & air temp, pressure) — up to 45 days back."""
    near = await buoys.nearest_stations(lat, lon, REGIONS["socal"])
    if not near:
        raise HTTPException(404, "No buoys nearby")
    chosen = next((s for s in near if s["id"] == station), None) or near[0]
    rows = await buoys.history(chosen["id"])
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = [r for r in rows if datetime.fromisoformat(r["t"]) >= cutoff]
    return {"station": chosen, "nearby": near, "days": days, "rows": rows, "kind": "observed"}


@router.get("/tides/range")
async def tide_range(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                     begin: str = Query(..., description="YYYY-MM-DD"), end: str = Query(..., description="YYYY-MM-DD")):
    """Tides for any past or future dates (max 31 days per request)."""
    try:
        b = datetime.fromisoformat(begin).replace(tzinfo=timezone.utc)
        e = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")
    try:
        return await tides.tide_range(lat, lon, b, e)
    except Exception as ex:
        raise HTTPException(502, f"Tide data unavailable: {ex}")
