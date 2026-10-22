# SoCal Fishing App (working name — TBD)

Map-first fishing, marine chart and ocean-conditions app for Southern California and North Baja.
Free, supported by ads and local sponsors.

**Start here:** [SETUP.md](SETUP.md) — step-by-step from zero to the app running on your iPhone.

## What's in this repo (Week 0 / Week 1 slice)

| Folder | What it is |
| --- | --- |
| `mobile-files/` | Files you copy into the Expo app after creating it (SETUP.md step 5) |
| `api/` | FastAPI backend, deployed to Render |
| `db/migrations/` | Postgres + PostGIS schema with row-level security (run in Supabase, in number order). `002_fishing_groups.sql` adds invite-only groups and live boat positions; the map screen for it is built right after sign-in (Week 4). |
| `db/seeds/` | Data-source registry seed. Real fishing spots load ONLY from licensed sources |
| `render.yaml` | Render blueprint for the API |
| `.env.example` | Every environment variable, with dummy values |

## Batch 1 — ocean & weather backend (done)

- Daily job (`api/ocean/jobs.py`, run free by GitHub Actions) pulls NOAA satellite **SST** and **chlorophyll** for SoCal,
  renders map tiles for 7 days of history (Latest / 24 h / 48 h / 3 d / 7 d), detects **temperature breaks** and
  **chlorophyll edges** (configurable strength), and builds the **seafloor relief + structure finder + contours** layer.
- `GET /conditions?lat&lon` — tap-anywhere card: water temp, nearest break in plain English ("Strong temperature break
  3.0 NM S: 60.2→65.0°F"), chlorophyll, depth, tide from the nearest NOAA station (with distance), NWS wind/seas/
  visibility/warnings, measured buoy waves/wind/water temp, moon, nearest spots, recent catch reports.
- `GET /layers` (catalog with dates, legend, source, observed time), `GET /tides`, `GET /buoys`.
- Every value carries source, dataset, observed time and kind (observed / interpolated / forecast / prediction).
- Automated tests: `python -m tests.run` (55 as of the Ad Studio).

## Redesign — Day / Night, simpler navigation, App Store ready (done)

- **Theme engine** (`mobile-files/src/theme.ts`): Day palette (white, defined borders, high contrast) and a red-light
  Night palette (no blue light, chart dimmed) with **Auto** by local sunrise/sunset; quick toggle on the map; every
  screen uses `makeStyles((colors) => …)` so both modes are complete.
- **Navigation**: 5 tabs (Map, Weather, Spots, Community, Me); Me is a Settings-style hub (display, catch log, coupons,
  offline maps, alerts, account, about). Map has three controls plus one **+** action grid.
- **Design system** (`components/ui.tsx`): Card, ListGroup/ListRow, SectionLabel, Segmented, ScreenHeader, IconButton,
  Btn with icons — Ionicons throughout.
- **App Store**: in-app account deletion (`010_account_deletion.sql`), reviewer demo login, privacy manifest,
  non-exempt-encryption flag, iPhone-only, icon/splash placeholders, hosted privacy/terms/support pages
  (`apps/legal`, built by `tools/build_legal.py`), and a step-by-step submission guide `docs/APP_STORE.md`.

## Ad Studio — self-serve advertising (done)

- **Separate web app** (`apps/studio`, installable on a phone home screen, free static hosting) for advertisers and you.
- **Advertisers**: email sign-in, business profile, 5-step ad builder with live price quote (weekly rates, area
  targeting, multi-week discounts, estimated views from real traffic, sold-out weeks), uploads of **images, GIFs, MP4
  video, PDF flyers/coupons, HTML5 animations (.zip bundled into one sealed file)**, Canva guidance with exact sizes,
  no-design **Quick ads**, tap actions (website / call / directions / coupon), **phone preview in the real app layout**,
  messages, card payment, invoices and live **results** (views, reach, taps, calls, directions, coupons, video plays, areas).
- **You (owner)**: dashboard (to review, live, paid, owed, booked), approve / ask for changes / reject with price and
  date edits, manual payments (Zelle, Venmo, check, cash, comp) or **Stripe Checkout**, run-before-payment, pause,
  booking calendar with capacity, advertisers with private notes and logins, price list editor, CSV export, pushes for
  new ads, messages and payments.
- Approved + paid orders become live campaigns automatically; the app serves them by placement, context and coarse area.
- Database `009_ad_platform.sql` with row-level security (businesses only ever see their own ads); scenario test
  `db/tests/run_ads_test.sh`. Stripe via plain HTTPS with webhook signature checks (`api/features/billing.py`).

## Fishing groups 2 — crew features (done)

- **Invite by email** (in-app invite + push if they have the app; share-sheet message with the download link + code)
  or by 6-character code. Owners remove members or delete the group; invites can be withdrawn.
- **Live vs last known** buddy boats (purple / gray "last seen"), 24 h last-known window, per-member off switch,
  low-power background updates while sharing.
- **"Come to me" / send my position**: exact GPS to the group; the push opens **Go To** straight to that boat.
- **Group-only sharing** of catches (exact spot, even when private on the public map), saved spots and routes;
  group **feed** with messages, live updates, per-group mute; group pins on the map (last 24 h).
- **Float plans**: back-by time, check-ins, extend, "back at the dock"; **automatic overdue alert** to the group with
  the last known position (pg_cron every 5 min), plus an "Are you OK?" push to the boater.
- Push sent by the database (pg_net → Expo) — no extra server. Rate limits and row-level security on everything;
  scenario test in `db/tests/run_groups_test.sh`.

## Weather page + "Can my boat handle it?" (done)

- **Weather tab**: your GPS location, any searched spot, a harbor quick-pick, or "5-day weather" from any spot on the map.
- **Forecast**: 5 days hourly from the NWS gridpoint forecast (wind, gusts, combined seas, primary/secondary swell and
  period, wind waves, air temp, rain, visibility, weather); day cards with verdict, wind/seas/temp ranges, **best
  window**, sunrise/sunset and moon; NWS alerts; the official **marine zone text** (Coastal Waters Forecast); nearest
  buoy measured now. Saved for offline.
- **Boat rating** (`api/seas/rating.py`): Comfortable / Bumpy / Rough / Stay in per hour for the user's boat type,
  length and comfort level, using wave steepness (NWS WR TA 03-11), the 2× period rule, NWS Small Craft Advisory /
  gale criteria and active warnings as a floor, and optional course (beam vs head seas). Reasons shown for every hour.
- **Past data**: measured buoy history up to 45 days (waves, period, wind + gusts, water/air temp, pressure).
- **Tides**: any past or future date — predicted highs/lows and curve, plus measured water level where there's a gauge.
- **Sponsor slot**: "Marine forecast presented by ___"; media kit shows boat mix ("What they run").

## Metrics & business admin (done)

- **Anonymous first-party analytics** (`POST /events`, no third-party SDK): random install ID, event names, tiny
  properties, platform/version, coarse area only; server drops anything location-like or personal; opt-out switch;
  raw events purged after 400 days.
- **Daily metrics** (`metrics_daily`, refreshed hourly): DAU/WAU/MAU, stickiness, new installs, sessions, session
  length, signups, catches, reports, forum, groups, alerts, sponsor impressions/clicks, platform and area mix.
- **Admin console**: Overview, Audience (areas, platforms, versions, hours, weekdays, retention cohorts), Engagement
  (features, screens, layers, species), Ads & reports (inventory per slot, per-campaign reports + printable sponsor
  report), **Media kit** (print/PDF), Users (badge, suspend, admin), Broadcast push (1/day), Settings (ads/intro/
  maintenance/min-version/analytics switches, store downloads entry + CSV, metrics CSV export).

## Batch 4 — rules, offline, import/export, Today, sponsors, alerts, admin (done)

- **Rules & hazards**: California MPAs (no take / limited), federal closures, Mexican reserves (when configured),
  NOAA chart wrecks, navigation buoys/lights, shipping lanes, anchorages — weekly job (`python -m ocean.jobs rules`),
  "last checked" date on every card (amber after 60 days), official-regs link.
- **MPA alert** computed on the phone for every GPS fix (works with no signal): vibration + banner; no-take can't be
  dismissed while inside; warnings when pinning, saving or logging inside.
- **Automatic offline Home waters pack**: chart + seafloor tiles (z5–12, Wi-Fi by default), today's SST/chlorophyll
  tiles, rules & hazards, 30-day tide predictions for every NOAA station in the region, public spots; refreshes on
  open and every 3 h; offline tide math on the phone; "Save this area offline" for extra detail (z10–14);
  Offline maps screen; "Offline" chip.
- **GPX / KML / KMZ import** with preview, duplicate detection, folders, never overwrites; **GPX export** of spots,
  routes and tracks via the share sheet. Track points moved to files (no Android size cap).
- **Today** dashboard (`GET /today`): catches by species, hot areas and activity patterns only with 3+ anglers,
  region water range + strong breaks, NWS warnings, buoys, announcements; opens once a day at the dock.
- **Sponsors**: built-in ad server (`/ads`, `/ads/event`), "Presented by" (Today, Catch Map, SST), banners (Today,
  reports, forum), 5-second intro only when stopped / not navigating / not recording / max every 4 h, contextual
  tags only, per-day caps on the phone, impressions/clicks/CTR.
- **Alerts** (species, bite activity, water temp, marine warnings): opt-in, max 4/day, ≥3 h apart, hourly job,
  Expo push.
- **Admin console** (`apps/admin`, free static site): moderation, spots, categories, sponsors, announcements,
  data health, audit log.
- Not included: programmatic ad networks (AdMob) — direct sponsors first; add later if wanted.

## Batch 3 — Catch Map & community (done)

- **Log Catch** (🎣 on the map or "Log a catch here" on any card): species, count, weight/length, kept/released,
  technique, bait, depths, meter marks, notes, photos (re-encoded on the phone so GPS/EXIF is stripped).
  Conditions at the catch time are attached automatically by `GET /snapshot` (that day's satellite image,
  tide prediction for that minute, moon; live wind/waves only for recent catches).
- **Privacy per catch**: Approximate (default, 0.5–1.5 NM fuzz that can't be averaged out) · Area only · Exact ·
  Private · + Anonymous. True coordinates never leave the owner-only table.
- **Offline queue**: catches save on the phone and send themselves when there's signal (safe to resend).
- **Catch Map**: species pills ("BFT × 17"), time filter 6 h–30 days, species filter, older activity fades,
  cluster summary (typical size, top techniques/baits, water temp range, latest), report flagging.
- **Verified reports** (in-app photo + reporter history) and the **Verified Reporter** badge, computed by the database.
- **My Fishing**: private log with filters (species, period, tide, moon, SST range, text), stats, catch detail with
  conditions and private photos, trips.
- **Community**: catch-report feed, forum (17 admin-editable categories, posts, comments, likes, report, block),
  rate limits, auto-hide after 3 reports, moderator tools with an audit log.
- **Fishing groups**: create/join by code, share for 4 h / 12 h / until midnight, hide me, buddy boats on the map
  (fade after 30 min), position sent only while sharing.
- Draft **Community Guidelines, Privacy Policy and Terms** in `docs/legal/` (have a lawyer review before launch).

## Batch 2 — app screens (done)

- Bottom tabs: Map · Spots · Community · My Fishing · Profile (the map stays running on every tab).
- **Layers sheet**: presets (Tuna hunt, Bottom fishing, Water color, Weather check, Chart only), seafloor relief +
  structure, contours, SST, temperature breaks, chlorophyll, green-to-blue edges, radar with 1-hour loop, wind
  forecast arrows (next 48 h), measured buoys; see-through levels; settings remembered.
- **Time bar**: Latest / 24 h / 48 h / 3 days / 7 days, play, hold-to-compare with 3 days earlier, legend, data age.
- **Search** (server + offline local), **probe crosshair**, **full conditions on every spot/pin card**, buoy cards.
- **Spots** tab (my spots / known spots), **Profile** with email-code sign-in and the **Data sources** page.
- Backend: `GET /conditions?fields=` light mode for the probe; GFS **wind** job (`python -m ocean.jobs wind`).
- Not yet: animated wind *streaks* (arrows for now) and a true side-by-side swipe compare (hold-to-flip for now).

## What works after setup

- Full-screen NOAA nautical chart (NOAA Chart Display Service)
- GPS position; **speed over ground** (from the GPS chip, or calculated from movement when the chip reports none, smoothed) and **course over ground**
- **Compass** heading with North-up / Heading-up / Course-up map modes
- Long-press any water → coordinates (DDM), distance and bearing; save private spots
- **Go to** any spot or pin: distance, bearing, steering cue, ETA, off-course (XTE), arrival vibration, screen stays on
- **Routes**: tap points to build multi-leg routes, save them, navigate leg by leg with auto-advance
- **Tracks**: record trips (keeps going with the screen off if allowed), see distance, time, max and average speed; save and replay
- Public fishing spots cached on the phone for offline use
- Everything is stored on the phone and works with no signal (cloud sync comes in Week 4)
- Backend `/health`, `/sources` and `/spots/search` running on Render against Supabase

## Rules this codebase follows (from the master spec)

1. Every data value carries its source and time. Stale data is shown as stale.
2. Private spots are private by default, enforced by the database (RLS), not just the UI.
3. No fake data presented as real. Dev/test rows are named as such.
4. Navigation assistance only — "Go To" is a straight-line bearing, never a route.

## Roadmap

Planned features and the order to build them: [`docs/ROADMAP.md`](docs/ROADMAP.md).
