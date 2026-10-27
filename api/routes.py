"""Endpoints for ocean layers and conditions."""
import asyncio
import json

from fastapi import APIRouter, HTTPException, Query, Request

from fastapi import Body
from fastapi.responses import JSONResponse

from conditions import buoys, tides
from features import support as support_mod
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
    hd = store.get("manifests/bottomhd.json")             # HD bottom (sharp relief + dense contours), where built
    if hd:
        out.append(json.loads(hd))
    harbors = store.get("manifests/harbors.json")
    if harbors:
        out.append({"key": "harbors", **json.loads(harbors)})
    rules = store.get("manifests/rules.json")
    if rules:
        out.append({"key": "rules", **json.loads(rules)})
    out.extend(EXTERNAL_LAYERS)
    return {"layers": out}


@router.get("/air")
async def air(all: bool = Query(False, description="include airliners up high")):
    """Live air traffic over the SoCal waters, with circling / likely-spotter planes flagged (see air/traffic.py)."""
    from air.traffic import current
    return JSONResponse(await current(include_high=all), headers={"Cache-Control": "no-store"})


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


@router.get("/ads/featured")
async def ads_featured(request: Request, kinds: str = "", area: str | None = None):
    """Gold "Featured" business pins for the switched-on harbor layers (fuel, bait, marina)."""
    area = area if area in analytics_mod.AREAS else None
    return await ads_mod.featured(getattr(request.app.state, "pool", None), [k for k in kinds.split(",") if k], area=area)


@router.post("/feedback")
async def feedback(request: Request, body: dict = Body(...)):
    """Me → Send feedback. Rate-limited per network address."""
    ip = request.client.host if request.client else "?"
    if not support_mod.rate_ok(f"fb:{ip}", 20):
        raise HTTPException(429, "Too many messages, try again later")
    try:
        f = support_mod.clean_feedback(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    ok = await support_mod.store_feedback(getattr(request.app.state, "pool", None), f)
    if not ok:
        raise HTTPException(503, "Feedback is not set up")
    return {"ok": True}


@router.post("/reports/errors")
async def error_reports(request: Request, body: dict = Body(...)):
    """Crash reports saved on the phone and sent on the next launch."""
    ip = request.client.host if request.client else "?"
    if not support_mod.rate_ok(f"err:{ip}", 60):
        return {"stored": 0}
    try:
        errs = support_mod.clean_errors(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"stored": await support_mod.store_errors(getattr(request.app.state, "pool", None), errs)}


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
async def offline_style(tiles: list[str] | None = Query(None), t: str | None = None):
    """Tile list either as ?t=<base64url JSON list> (the app's form: no %-codes in the address, which crash the
    phone's map engine when a request fails) or the older ?tiles=...&tiles=... form."""
    if t:
        import base64
        try:
            tiles = json.loads(base64.urlsafe_b64decode(t + "=" * (-len(t) % 4)).decode())
        except Exception:
            raise HTTPException(400, "bad tile list")
    if not tiles or not all(isinstance(x, str) and x.startswith("https://") for x in tiles):
        raise HTTPException(400, "tiles required")
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


# ---------------------------------------------------------------- auto route (water route around land)
import threading as _threading
import time as _time

_nav_state = {"nd": None, "at": 0.0}
_nav_lock = _threading.Lock()


def _navdata():
    """The water map, re-read every 6 hours (the navmask job may have added tiles)."""
    if _nav_state["nd"] is None or _time.time() - _nav_state["at"] > 6 * 3600:
        from navroute.grid import NavData
        try:
            _nav_state["nd"] = NavData(get_store())
        except Exception:
            _nav_state["nd"] = None
        _nav_state["at"] = _time.time()
    return _nav_state["nd"]


_launch_state = {"pts": None, "at": 0.0}


def _launches():
    """Launch ramps and marinas (for routes planned from land), re-read every 6 hours."""
    if _launch_state["pts"] is None or _time.time() - _launch_state["at"] > 6 * 3600:
        from navroute.router import launch_points
        try:
            raw = get_store().get("vectors/harbors/socal.geojson")
            _launch_state["pts"] = launch_points(json.loads(raw)) if raw else []
        except Exception:
            _launch_state["pts"] = []
        _launch_state["at"] = _time.time()
    return _launch_state["pts"]


def _route_sync(points, safety_ft):
    from navroute.router import route as find_route
    with _nav_lock:                     # one route at a time: keeps the free server's memory in check
        nd = _navdata()
        if nd is None:
            return None
        return find_route(nd, points, safety_ft, launches=_launches())


@router.get("/route")
async def auto_route(pts: str = Query(..., description="lat,lon;lat,lon[;…] — start, optional via points, end"),
                     safety_ft: float = Query(8, ge=1, le=100, description="avoid charted water shallower than this")):
    """Shortest water route that goes around land, breakwaters and docks, from NOAA charts (like Auto Guidance).
    A planning aid only — the app shows it with a check-the-chart note."""
    try:
        points = [tuple(float(v) for v in p.split(",")) for p in pts.split(";") if p.strip()]
        assert 2 <= len(points) <= 12 and all(len(p) == 2 and -90 <= p[0] <= 90 and -180 <= p[1] <= 180 for p in points)
    except Exception:
        raise HTTPException(400, "pts must be 2–12 points as lat,lon;lat,lon")
    from navroute.router import NoRoute
    try:
        r = await asyncio.to_thread(_route_sync, points, safety_ft)
    except NoRoute as e:
        return JSONResponse(status_code=422, content={"detail": f"No water route found ({e}). Use the straight line and check the chart."})
    if r is None:
        return JSONResponse(status_code=503, content={"detail": "Auto route isn't ready yet — the water map is still being built."})
    return r
