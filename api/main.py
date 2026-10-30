"""Fishing app API — Week 0/1.

Endpoints:
  GET /health          -> liveness + database check
  GET /sources         -> data-source registry (powers the in-app Data Sources page)
  GET /spots           -> fishing spots in a bounding box, as GeoJSON (the app caches this for offline)
  GET /spots/search    -> fishing-spot search by name / alternate name / number
  GET /conditions      -> everything known about a tapped point (see conditions/service.py)
  GET /layers          -> SST / chlorophyll / seafloor / radar layer catalog with dates and sources
  GET /tides, /buoys   -> tide curve for a point; buoy observations as GeoJSON
"""
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from fastapi.staticfiles import StaticFiles

from routes import router as ocean_router
from seas.routes import router as weather_router

DATABASE_URL = os.environ.get("DATABASE_URL", "")
pool: AsyncConnectionPool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    if DATABASE_URL:
        # prepare_threshold=None is required for Supabase's transaction pooler (port 6543)
        pool = AsyncConnectionPool(
            DATABASE_URL, min_size=1, max_size=5, open=False,
            kwargs={"prepare_threshold": None, "row_factory": dict_row},
        )
        await pool.open()
    app.state.pool = pool
    # Oct 27: watch the air traffic around the clock and send spotter-plane alerts (air/alerts.py)
    import asyncio
    from air.alerts import loop as spotter_loop
    watcher = asyncio.create_task(spotter_loop(pool))
    # Oct 28: San Clemente Island closure alerts (sci/alerts.py)
    from sci.alerts import loop as sci_loop
    sci_watcher = asyncio.create_task(sci_loop(pool))
    yield
    watcher.cancel()
    sci_watcher.cancel()
    if pool:
        await pool.close()


app = FastAPI(title="Fishing App API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(ocean_router)
app.include_router(weather_router)

# Development: serve locally generated tiles. In production tiles come from Cloudflare R2 directly.
if os.environ.get("STORAGE", "local") == "local":
    _data = os.environ.get("LOCAL_DATA_DIR", "data")
    os.makedirs(_data, exist_ok=True)
    app.mount("/data", StaticFiles(directory=_data), name="data")


def _pool() -> AsyncConnectionPool:
    if pool is None:
        raise HTTPException(503, "DATABASE_URL is not set on the server")
    return pool


@app.get("/health")
async def health():
    db = "not configured"
    if pool is not None:
        try:
            async with pool.connection() as conn:
                await conn.execute("select 1")
            db = "ok"
        except Exception as e:  # report, don't crash
            db = f"error: {type(e).__name__}"
    return {"status": "ok", "database": db, "time": datetime.now(timezone.utc).isoformat()}


@app.get("/sources")
async def sources():
    async with _pool().connection() as conn:
        cur = await conn.execute(
            """select name, provider, product, docs_url, license_url, attribution,
                      update_freq, commercial_notes, last_verified_at
               from data_sources where enabled order by name"""
        )
        return await cur.fetchall()


@app.get("/spots/search")
async def search_spots(
    q: str = Query(..., min_length=1, max_length=60),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    limit: int = Query(10, ge=1, le=25),
):
    """Matches canonical name, alternate names and numbered spots ("14", "209", "Lasuen").
    If lat/lon is given, returns distance in nautical miles from that point."""
    async with _pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, canonical_name, alternate_names, spot_type, region,
                   st_y(st_pointonsurface(geom::geometry)) as lat,
                   st_x(st_pointonsurface(geom::geometry)) as lon,
                   source_name, source_license,
                   case when %(lat)s::float8 is null or %(lon)s::float8 is null then null
                        else st_distance(geom, st_makepoint(%(lon)s, %(lat)s)::geography) / 1852.0
                   end as distance_nm,
                   greatest(similarity(canonical_name, %(q)s),
                            coalesce((select max(similarity(a, %(q)s)) from unnest(alternate_names) a), 0)) as score
            from fishing_spots
            where status = 'active'
              and (canonical_name ilike %(like)s
                   or exists (select 1 from unnest(alternate_names) a where a ilike %(like)s)
                   or canonical_name %% %(q)s)
            order by (canonical_name ilike %(prefix)s) desc, score desc, distance_nm nulls last
            limit %(limit)s
            """,
            {"q": q, "like": f"%{q}%", "prefix": f"{q}%", "lat": lat, "lon": lon, "limit": limit},
        )
        return await cur.fetchall()


@app.get("/spots")
async def spots_in_bbox(bbox: str = Query(..., description="minLon,minLat,maxLon,maxLat")):
    try:
        min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be minLon,minLat,maxLon,maxLat")
    async with _pool().connection() as conn:
        cur = await conn.execute(
            """
            select id::text, canonical_name, spot_type::text, region, source_name,
                   st_x(st_pointonsurface(geom::geometry)) as lon,
                   st_y(st_pointonsurface(geom::geometry)) as lat
            from fishing_spots
            where status = 'active'
              and geom && st_makeenvelope(%s, %s, %s, %s, 4326)::geography
            limit 5000
            """,
            (min_lon, min_lat, max_lon, max_lat),
        )
        rows = await cur.fetchall()
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                "properties": {
                    "id": r["id"], "name": r["canonical_name"],
                    "subtitle": f"{r['spot_type'].replace('_', ' ').title()} · source: {r['source_name']}",
                },
            }
            for r in rows
        ],
    }
