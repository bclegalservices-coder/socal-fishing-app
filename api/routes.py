"""Endpoints for ocean layers and conditions."""
import asyncio
import json

from fastapi import APIRouter, HTTPException, Query, Request

from fastapi import Body
from fastapi.responses import JSONResponse

from conditions import buoys, tides
from features import ads as ads_mod, analytics as analytics_mod, billing as billing_mod, offline as offline_mod, today as today_mod
from datetime import datetime, timezone

from conditions.service import conditions as get_conditions
from conditions.snapshot import snapshot as get_snapshot
from core.storage import get_store
from ocean.registry import EXTERNAL_LAYERS, REGIONS

router = APIRouter()


@router.get("/conditions")
async def conditions(request: Request, lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                     fields: str | None = Query(None, description="comma list, e.g. water,depth (probe mode)")):
    """Everything known about one point: water temp + breaks, chlorophyll + edges, depth, tide, wind,
    waves (measured and forecast), warnings, moon, nearest spots and recent catch reports."""
    want = {f.strip() for f in fields.split(",")} if fields else None
    return await get_conditions(lat, lon, getattr(request.app.state, "pool", None), want)


@router.get("/layers")
async def layers():
    """Layer catalog for the app's Layers sheet: tile URLs per date, legend, source, observed time."""
    store = get_store()
    out = []
    for key in ("sst", "chl", "bathy", "wind"):
        raw = store.get(f"manifests/{key}.json")
        m = json.loads(raw) if raw else None
        if m and "dates" in m:
            # Only dates that have map tiles: a broken entry would make the app's map engine crash.
            m["dates"] = [d for d in m["dates"] if isinstance(d.get("tiles"), str) and d["tiles"]]
            if not m["dates"]:
                m = None
        if m:
            out.append({"key": key, **m})
        else:
            out.append({"key": key, "available": False, "note": "Not processed yet — run the ocean job."})
    rules = store.get("manifests/rules.json")
    if rules:
        out.append({"key": "rules", **json.loads(rules)})
    out.extend(EXTERNAL_LAYERS)
    return {"layers": out}


@router.get("/tides")
async def tide(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    try:
        return await tides.tide_at(lat, lon)
    except Exception as e:
        raise HTTPException(502, f"Tide data unavailable: {e}")


@router.get("/buoys")
async def buoy_layer(region: str = "socal"):
    """Buoys with their latest MEASURED wind / waves / water temp, as GeoJSON."""
    bbox = REGIONS.get(region)
    if not bbox:
        raise HTTPException(404, "Unknown region")
    sts = await buoys.stations_in(bbox)
    obs = await asyncio.gather(*[buoys.latest(s["id"]) for s in sts], return_exceptions=True)
    feats = []
    for s, o in zip(sts, obs):
        if isinstance(o, BaseException) or not o:
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
                      "properties": {"id": s["id"], "name": s["name"], "kind": "observed", **o}})
    return {"type": "FeatureCollection", "features": feats}


@router.get("/snapshot")
async def snapshot(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                   at: str | None = Query(None, description="ISO time of the catch; default now")):
    """Conditions at the moment of a catch, shaped like the env_snapshots table (the app saves it with the catch)."""
    when = datetime.fromisoformat(at.replace("Z", "+00:00")) if at else datetime.now(timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if when > datetime.now(timezone.utc).replace(microsecond=0) and (when - datetime.now(timezone.utc)).total_seconds() > 600:
        raise HTTPException(400, "Catch time is in the future")
    return await get_snapshot(lat, lon, when)


@router.get("/today")
async def today(request: Request):
    """SoCal Fishing Today: catches by species, hot areas and activity (3+ anglers only), water, warnings, buoys."""
    return await today_mod.build(getattr(request.app.state, "pool", None))


@router.get("/ads")
async def ad(request: Request, placement: str, section: str | None = None, tags: str = "", area: str | None = None):
    """One sponsor for a placement. Contextual tags (e.g. 'tuna,catalina') and the phone's COARSE area
    (e.g. 'Orange County') only; no personal data."""
    area = area if area in analytics_mod.AREAS else None
    a = await ads_mod.pick(getattr(request.app.state, "pool", None), placement, section, [t for t in tags.split(",") if t], area=area)
    return a or JSONResponse(status_code=204, content=None)


@router.get("/billing/config")
async def billing_config():
    """What the Ad Studio should offer: card payments only when Stripe is set up."""
    return {"stripe": billing_mod.enabled()}


@router.post("/billing/checkout")
async def billing_checkout(request: Request, body: dict = Body(...)):
    """Approved, unpaid ad → Stripe's hosted card page. Needs the advertiser's sign-in token."""
    token = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    try:
        return await billing_mod.create_checkout(getattr(request.app.state, "pool", None), int(body.get("order_id", 0)), token)
    except PermissionError as e:
        raise HTTPException(401, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/billing/webhook")
async def billing_webhook(request: Request):
    """Stripe calls this after a payment. Signature-checked; marks the order paid and puts it live."""
    try:
        return await billing_mod.handle_webhook(getattr(request.app.state, "pool", None), await request.body(),
                                                request.headers.get("stripe-signature"))
    except PermissionError:
        raise HTTPException(400, "Invalid signature")


@router.post("/ads/event")
async def ad_event(request: Request, body: dict = Body(...)):
    area = body.get("area") if body.get("area") in analytics_mod.AREAS else None
    await ads_mod.log_event(getattr(request.app.state, "pool", None), int(body.get("campaign_id", 0)), str(body.get("event")),
                            str(body.get("placement")), body.get("context"), body.get("device_day_hash"), area)
    return {"ok": True}


@router.get("/offline/style.json")
async def offline_style(tiles: list[str] = Query(...)):
    return offline_mod.style(tiles)


@router.get("/tides/pack")
async def tide_pack(region: str = "socal", days: int = Query(30, ge=1, le=60)):
    return await offline_mod.tide_pack(region, days)


@router.post("/events")
async def events(request: Request, body: dict = Body(...)):
    """Anonymous usage events from the app (batched). Location-like or personal fields are dropped."""
    try:
        b = analytics_mod.clean_batch(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not analytics_mod.rate_ok(b["install_id"], len(b["events"])):
        raise HTTPException(429, "Too many events")
    n = await analytics_mod.store(getattr(request.app.state, "pool", None), b)
    return {"stored": n}
