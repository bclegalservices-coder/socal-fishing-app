"""Offline Home waters pack helpers: a style the phone's map engine can download tiles from, and a
30-day tide pack for every NOAA prediction station in the region."""
import asyncio
from datetime import datetime, timedelta, timezone

from conditions import tides
from ocean.registry import REGIONS


def style(tile_templates: list[str]) -> dict:
    """MapLibre style listing exactly the tile URLs the app uses, so downloaded tiles match the live map."""
    sources, layers = {}, [{"id": "bg", "type": "background", "paint": {"background-color": "#0C1D2A"}}]
    for i, t in enumerate(tile_templates[:6]):
        sources[f"s{i}"] = {"type": "raster", "tiles": [t], "tileSize": 256}
        layers.append({"id": f"l{i}", "type": "raster", "source": f"s{i}"})
    return {"version": 8, "name": "offline-pack", "sources": sources, "layers": layers}


async def tide_pack(region: str = "socal", days: int = 30, max_stations: int = 25) -> dict:
    bbox = REGIONS[region]
    sts = [s for s in await tides.stations() if bbox[0] <= s["lon"] <= bbox[2] and bbox[1] <= s["lat"] <= bbox[3]][:max_stations]
    now = datetime.now(timezone.utc)
    b, e = now.strftime("%Y%m%d"), (now + timedelta(days=days)).strftime("%Y%m%d")

    async def one(s):
        try:
            hilo, curve = await asyncio.gather(tides.predictions(s["id"], b, e, "hilo"), tides.predictions(s["id"], b, e, "h"))
            return {**s, "hilo": hilo, "hourly": [[p["t"], p["v"]] for p in curve]}
        except Exception:
            return None

    out = [x for x in await asyncio.gather(*[one(s) for s in sts]) if x]
    return {"region": region, "generated_at": now.isoformat(), "through": (now + timedelta(days=days)).date().isoformat(),
            "source": "NOAA CO-OPS tide predictions", "kind": "prediction", "stations": out}
