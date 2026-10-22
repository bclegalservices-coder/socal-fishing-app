# Roadmap: planned features (not built yet)

Ideas we've agreed on, written down so they can be built in order. Each has the why, how it works, what it needs,
and a rough size. **Status** is updated as work happens.

| # | Feature | Needs the server? | Size | Status |
| --- | --- | --- | --- | --- |
| 1 | Server setup (Supabase + Render + daily ocean job) | — | 1 evening | Next |
| 2 | Automatic data updates + "what changed" notices | Yes | 2–3 days | Planned |
| 3 | Rules text editable from the admin console | Yes | 1 day | Planned |
| 4 | Admin push alerts for closures / rule changes | Yes | 1 day | Planned |
| 5 | Over-the-air app updates | No | ½ day | Built (#12) |
| 6 | Server copy (cache) of the NOAA chart | Yes | 1–2 days | Planned |
| 7 | Crowd-sourced depth ("our SonarChart") | Yes | 2–4 weeks | After launch |
| 8 | Polish pass, screen by screen, on a real iPhone | No | ongoing | In progress |
| 9 | Final name, icon and launch logo | No | ½ day | Waiting on logo pick |
| 10 | Live wind map (colored speed + moving wind streaks + station arrows) | Yes | 4–6 days | Planned |
| 12 | Over-the-air app updates — scripts ready (`mobile/scripts/ota-setup.sh`, `ship.sh`) | No | done | Set up before the iPhone build |
| 13 | Multiple regions (see docs/REGIONS.md) | Yes | 3–5 days | Planned |
| 11 | Water clarity layer (Copernicus daily gap-free transparency) + "actual satellite pass" chlorophyll view | Yes | 1 day | Planned |

---

## 2. Automatic data updates + "what changed" notices

**Why.** MPAs, closures, regulations, NOAA charts, soundings and wrecks all change. Anglers must never fish on stale
rules, and they shouldn't have to update anything themselves.

**What already updates by itself (built):**
- NOAA chart, soundings, buoys, wrecks: pulled live from NOAA's Maritime Chart Service (NOAA publishes weekly).
- Relief (NOAA NCEI) and satellite (USGS): live.
- MPA boundaries: re-downloaded from our server, or straight from CDFW, whenever the app opens online (at most
  every 3 hours), and saved on the phone for use with no signal (`src/offline/rules.ts → refreshRules`).

**To build:**
1. **Version every rules download.** Server job stores a hash per layer (MPAs, closures, Mexico MPAs, hazards) and the
   date it last changed. The app keeps the previous copy.
2. **Diff on the phone.** After a refresh, compare old vs new by MPA name + geometry hash + rule text → list of
   added / removed / changed areas.
3. **One-time notice.** Banner on the map: *"MPA rules updated: Farnsworth Offshore SMCA (boundary), Cowcod
   Conservation Area (dates). Tap to see what changed."* The tap opens a list; each row opens that area's card with the
   changed part highlighted. Stored as "seen" so it shows once.
4. **Offline chart pack refresh weekly** instead of every 30 days (`packs.ts → autoRefresh`, `chartOld`), matching
   NOAA's weekly ENC updates. Still Wi-Fi only by default.
5. **"Rules checked" date** stays on every MPA card; turns amber after 60 days without a successful check (built).

**Server pieces:** `api/rules/job.py` already fetches CDFW / NOAA ENC layers. Add: hash + `changed_at` per layer,
a `rules_changes` table (what changed, when), and include both in `/layers`.

## 3. Rules text editable from the admin console

**Why.** The "Allowed here" lists for each SMCA are currently built into the app (`src/offline/rules.ts → ALLOWED`).
When the Fish and Game Commission changes a rule, we need to fix it in minutes, not wait for an app release.

**How.** New table `mpa_rules (mpa_name, designation, allowed jsonb, notes jsonb, source, reviewed_at, reviewed_by)`.
Admin console page: list of MPAs, edit "allowed" lines, mark reviewed. `/layers` returns the table; the app uses it
and falls back to the built-in list when offline or before first download. Every edit appears in the change notices (#2).

**Before launch:** review every South Coast SMCA line against CDFW's current regulations (the built-in list comes from
CDFW's regulation-summary wording; the Commission had MPA items on its October 2026 agenda).

## 4. Admin push alerts for closures and rule changes

**Why.** Emergency closures (e.g. a sudden area closure, domoic acid, a new MPA) need to reach people now.

**How.** Admin console → "Send alert": title, message, optional area (draw or pick an MPA), audience (everyone /
people whose last position or saved spots are within N miles). Uses the existing Expo push path (`send_push` in
`008_groups_plus.sql`). Tapping the alert opens the map on that area. Rate-limited, logged, and every alert also
lands in the "what changed" list.

## 5. Over-the-air app updates

**Why.** Ship fixes and design changes to everyone without an App Store review.

**How.** `expo-updates` + EAS Update channels (`production`, `preview`). The app checks on launch and applies the update
next open. App Store builds are only needed for new native abilities (new permissions, the boat Wi-Fi/NMEA connection
in #7, new native libraries). Free tier to start; if it ever costs money at scale, self-host the open Expo Updates
protocol on the Render server.

## 6. Server copy (cache) of the NOAA chart

**Why.** NOAA's chart server occasionally answers a burst of requests with an HTML error page instead of an image, so a
chart square comes up blank. (The app now asks for 4x fewer, larger squares and logs failures quietly, but it can still
happen.)

**How.** `/chart/{z}/{x}/{y}.png` on our API: fetch from NOAA once, keep it in Cloudflare R2 (free tier) for a week,
retry NOAA politely on errors, serve from cache after. The app points `NOAA_CHART_TILES` at it, with NOAA direct as
the fallback. Same for relief tiles. Also makes offline-pack downloads faster and gentler on NOAA.

## 7. Crowd-sourced depth ("our SonarChart")

**Why.** Navionics' SonarChart is built from users' depth sounders and is a big reason people pay. We can build our own
from our users, and it gets sharper the more people fish an area.

**Where depth comes from (the phone has no sonar):**
1. **Live from the boat (best):** the app joins the boat's Wi-Fi (chartplotter Wi-Fi or a $100–200 NMEA Wi-Fi gateway)
   and reads standard NMEA 0183/2000 depth (DPT/DBT) and position over TCP/UDP. Logs a sounding every 1–2 s while
   underway. Works across Garmin, Lowrance, Simrad, Raymarine, Furuno. Needs an App Store build (local-network permission).
2. **Sonar log upload:** Lowrance `.sl2/.sl3`, Humminbird, Garmin logs from the unit's memory card; the server extracts
   depth + position.
3. **Manual depth with catch reports:** already collected (depth field on Log a catch).

**Processing (server):** tide correction (NOAA tides, already in the API) → transducer-depth offset (boat profile) →
outlier removal (fish/bait marks, spikes, speed limits) → median per ~10 m grid cell, weighted by count and recency →
blend with NOAA survey depth → contour lines every 5–10 ft → a "Community depth" layer in Map options.

**Privacy (non-negotiable):** opt-in switch, off by default. Nobody ever sees anyone's tracks. Only blended contours,
built from several boats, published with a delay. Cells with a single contributor are never shown. Users can delete
their contributions. Optional: contribute anonymized data to the IHO Data Centre for Digital Bathymetry (NOAA's
crowd-sourced bathymetry program), which is good for credibility.

**Order:** manual depth → log upload → live NMEA. Ship the "Community depth" layer once an area has enough coverage.

## 7b. Finer chart controls (NOAA Maritime Chart Service display settings)

NOAA's chart service accepts display settings per request (`/parameters` on the service): `ColorScheme` (0 day,
1 dusk, 2 night: a real night chart to pair with the app's Night mode), `PointSymbolizationType` (simplified vs paper
symbols, simplified is cleaner), `DisplayLightSectors`, `DisplayCategory`, safety/shallow/deep contours,
`TwoDepthShades`, and text groups. Wire these into Map options. Cables and wrecks come in the same NOAA layer
(seabed), so to let people hide cables but keep wrecks, show wrecks as our own layer from the server's ENC wreck
download (`api/rules`, kind `wreck`) and give it its own switch.

## 10. Live wind map (WindAlert-style)

**Why.** Seeing the whole wind field at a glance (where it's blowing, how hard, and where the lee is behind Catalina)
decides most trips. WindAlert's look: the water colored by wind speed, short streaks drifting with the wind, and arrows
with numbers at real weather stations.

**What exists already:** a GFS (0.25°, ~25 km) wind forecast as small arrows every 3 h for 48 h (`api/ocean/wind.py`),
buoy readings, and the Weather tab's boat rating.

**Build, in three layers that can each be switched on:**
1. **Colored wind speed:** the server renders the wind field as map squares colored by speed (white → blue → green
   → yellow → red, matching the legend users know), one set per forecast hour, saved to R2 like the water-temp tiles.
   Source: **NOAA HRRR** (3 km, updated hourly, 18–48 h ahead; free on NOAA's open-data AWS bucket), with GFS beyond
   HRRR's range. HRRR winds are grid-relative and must be rotated to true north (noted in `wind.py`).
2. **Moving wind streaks:** the server also writes a small u/v wind grid (JSON, a few hundred KB) per hour. The app
   animates a few thousand particles along it, drawn with `@shopify/react-native-skia` on top of the map and
   re-projected as you pan or zoom. They fade and respawn like WindAlert's. Needs one App Store build (new native
   library). Pauses automatically when moving fast or on low battery.
3. **Measured wind at stations:** arrows with speed numbers (and gusts) from NDBC buoys (already in the API), NWS
   airport/coastal stations (api.weather.gov observations), and CDIP. Tap for the last 24 h chart. Colored by speed
   on the same scale; gray when the reading is over an hour old.

**Controls:** time slider (Now → +48 h, plays as a loop), legend bar in mph or knots (user setting), "Measured only"
switch. Night mode uses the dimmed palette.

**Honest limits:** model wind is a forecast, so the layer says "Forecast" and shows the model run time. WindAlert
also uses its own private station network (WeatherFlow), which we can't use. Public stations are fewer, but HRRR
fills the gaps.

## 8. Polish pass

Screen by screen on the iPhone simulator / a real phone: spacing and alignment, type sizes, empty states ("No catches
near you yet: be the first"), the new logo inside the app, a calmer Night mode (deep navy with soft red accents instead
of all-red), bigger Navionics-style data bar (distance to waypoint, speed, ETA), and clearing the shadow warnings.

## 11. Water clarity + chlorophyll sources

**Chlorophyll now (built):** main source is the E.U. Copernicus Marine Service daily gap-free product
`cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D` (multi-satellite, clouds filled in, ~1 day old; tested
2026-10-20). Backups, tried in order: NOAA ERDDAP `nesdisVHNchlaDaily`, `nesdisVHNnoaa20chlaDaily`, `erdVHNchla1day`,
`erdVHNchla8day`. Needs GitHub secrets `COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD`. The app must show the credit
"Generated using E.U. Copernicus Marine Service Information". Check the Copernicus licence wording on commercial use
before launch.

**To build:** a "Water clarity" layer from `cmems_obs-oc_glo_bgc-transp_nrt_l4-gapfree-multi-4km_P1D` (same login,
same job, clean-blue vs green-murky water), and an optional "Actual satellite pass" view (NASA OB.DAAC VIIRS / PACE
near real-time, free Earthdata login) for people who want only measured pixels. NASA GIBS chlorophyll picture tiles
(`VIIRS_SNPP_L2_Chlorophyll_A`) can be an instant fallback display layer.
