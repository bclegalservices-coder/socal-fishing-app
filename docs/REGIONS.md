# Adding regions (scaling past Southern California)

Goal: turning on a new region (e.g. Northern California, Pacific Northwest, Gulf of Mexico) is a settings change plus
one job run, not new code. Regions are also how ads are sold (local brands advertise to local users).

## What already works anywhere in the US
NOAA chart (all US waters), relief, satellite, live radar (MRMS covers the US), NWS marine forecasts and warnings,
buoys, tides, harbor data from OpenStreetMap, catch reports, groups, offline packs.

## What is SoCal-specific today (to make region-aware)
| Piece | Today | Region-aware version |
|---|---|---|
| Region list | `REGIONS = {"socal": bbox}` in `api/ocean/registry.py`; app `REGION_BBOX` | `api/regions.json`: id, name, bbox, timezone, state, enabled, ad market |
| Daily jobs (SST, chlorophyll, wind, harbors) | run for `socal` | `--region all` loops enabled regions; files under `.../<region>/...` |
| Layer list `/layers` | one set of manifests | `/layers?region=<id>`; app asks for the region it's looking at |
| App | fixed region | picks the region from GPS / map center; "Region" setting in Me |
| MPAs & rules | CDFW (California) | per-state sources in `rules/layers.py` (OR, WA, FL, TX…) + NOAA federal areas |
| Harbor facilities | California DBW list + OSM | per-state boating lists where they exist, OSM everywhere |
| Fishing spots | SWYC list (SoCal/Baja) | per-region spot lists with permission; admin console import |
| Wind HD (HRRR) | SoCal box | any US region (HRRR covers the lower 48) |
| Sponsors | one market | `ad_campaigns.region` already exists; target by region |

## Cost check
Each region adds roughly the SoCal amount of storage and job time. Cloudflare R2's free 10 GB and GitHub Actions'
free minutes cover several regions; add regions one at a time and watch the admin console's Data health page.

## Order of work (planned)
1. `regions.json` + `--region all` + per-region manifests (server) and `/layers?region=` (back-compatible: no
   region = socal).
2. App: region from map center, cached per region for offline.
3. Rules sources per state; harbor lists per state.
4. Admin console: regions page (enable/disable, see data health per region).
