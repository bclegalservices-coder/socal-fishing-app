# Setup guide — from zero to the app on your iPhone

Time: about 2–3 hours spread over a couple of days (Apple can take up to 48 hours to approve a new developer account).
Cost: $0 except the Apple Developer Program ($99/yr).

You do **not** need a Mac. iPhone builds are made in Expo's cloud.

Each part ends with a **Check** — don't move on until it passes.

---

## Part A — Create accounts (15 min)

1. **GitHub** — https://github.com (you may already have one).
2. **Expo** — https://expo.dev/signup (free). This builds the iPhone app in the cloud.
3. **Supabase** — https://supabase.com (free, sign in with GitHub). This is the database + logins.
4. **Render** — https://render.com (free, sign in with GitHub). This runs the backend API.
5. **Apple Developer Program** — https://developer.apple.com/programs/enroll/ ($99/yr). Start this first; approval can take up to 48 hours. You can do Parts B–F while you wait.

**Check:** you can log in to all five.

---

## Part B — Install tools on your computer (20 min)

1. **Node.js (LTS version)** — https://nodejs.org → download the "LTS" installer → run it with defaults.
2. **Git** — https://git-scm.com/downloads → install with defaults. (Mac: it may already be installed.)
3. **VS Code** — https://code.visualstudio.com (the code editor).
4. **Python 3.12** — optional, only needed to run the API on your own computer. Render runs it for you.

Open a terminal (Mac: Terminal app · Windows: "PowerShell") and run:

```bash
node -v
npm -v
git --version
```

**Check:** each prints a version number (Node should be 20 or higher).

---

## Part C — Put the code on GitHub (15 min)

1. Unzip `socal-fishing-app.zip` somewhere easy, e.g. `Documents/socal-fishing-app`.
2. Go to https://github.com/new
   - Repository name: `socal-fishing-app`
   - Select **Private**
   - Do **not** add a README, .gitignore or license (the zip already has them)
   - Click **Create repository**. Leave that page open — it shows your repo URL.
3. In the terminal, go into the unzipped folder and push it:

```bash
cd ~/Documents/socal-fishing-app        # Windows: cd $HOME\Documents\socal-fishing-app
git init
git add .
git commit -m "Week 0 starter"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-NAME/socal-fishing-app.git
git push -u origin main
```

If Git asks for a password, GitHub no longer accepts your normal password. Either:
- create a token at https://github.com/settings/tokens → "Generate new token (classic)" → check `repo` → paste the token as the password, **or**
- install GitHub Desktop (https://desktop.github.com) and use "Add existing repository" → Publish.

**Check:** refresh the GitHub page — you see `api/`, `db/`, `mobile-files/`, `README.md`, `SETUP.md`, `render.yaml`.

---

## Part D — Database on Supabase (15 min)

1. Supabase dashboard → **New project**
   - Name: `fishing-app`
   - Database password: click **Generate**, then **copy it into a password manager now** (you need it in step 4).
   - Region: **West US (North California)** or the closest West Coast option.
   - Plan: Free → **Create new project**. Wait ~2 minutes.
2. Left sidebar → **SQL Editor** → **New query**.
   Open `db/migrations/001_init.sql` in VS Code, copy **all** of it, paste into the editor, click **Run**.
   You should see "Success. No rows returned."
   *(Run this file only once. Running it twice gives "type already exists" errors — harmless, but not needed.)*
3. **New query** again → paste all of `db/seeds/002_data_sources.sql` → **Run**.
3b. **New query** again → paste all of `db/migrations/002_fishing_groups.sql` → **Run** (fishing groups: groups, invite codes, live boat positions and their privacy rules).
3c. **New query** again → paste all of `db/migrations/003_catch_map_and_ads.sql` → **Run** (Catch Map, private fishing log, condition snapshots, report verification, ads and Pro-ready subscriptions).
4. Get the database connection string:
   - Click the **Connect** button at the top of the project.
   - Choose **Transaction pooler** (port **6543**) and copy the URI.
   - Replace `[YOUR-PASSWORD]` in it with the password from step 1.
   - Save this full string somewhere safe. This is your `DATABASE_URL`.
5. Get the app keys (used from Week 4): **Project Settings → API** → copy the **Project URL** and the **anon public** key.
   **Never** put the `service_role` key in the app — it bypasses all privacy rules.

**Check:** Table Editor (left sidebar) shows `data_sources`, `fishing_spots`, `fishing_groups`, `group_members`, `live_positions`, `profiles`, `regions`, `waypoints`, and `fishing_spots` contains one row named "DEV TEST SPOT".

---

## Part E — Backend API on Render (15 min)

1. Render dashboard → **New +** → **Blueprint**.
2. Connect your GitHub account if asked, then pick the `socal-fishing-app` repo. Render reads `render.yaml` and shows one service: `fishing-app-api`.
3. It asks for the secret values:
   - `DATABASE_URL` → paste the string from Part D step 4.
   - `NWS_USER_AGENT` → `(fishing-app-dev, your-email@example.com)` — the National Weather Service requires this later.
4. Click **Apply**. The first deploy takes 3–5 minutes. Watch the **Logs** tab; wait for "Your service is live".
5. Copy your service URL from the top of the page, e.g. `https://fishing-app-api.onrender.com`.

Open these in your browser (use your own URL):

| URL | What you should see |
| --- | --- |
| `…/health` | `"status":"ok","database":"ok"` |
| `…/spots/search?q=dev` | The DEV TEST SPOT with its lat/lon |
| `…/sources` | The NOAA Chart Display Service row |
| `…/docs` | Interactive API documentation |

**Free plan note:** the server sleeps after ~15 minutes of no traffic; the next request takes up to a minute to wake it. Fine for development. (The $7/mo "Starter" plan removes this at launch.)

**If `/health` says `database: error`:** the `DATABASE_URL` is wrong. Most common causes: the `[YOUR-PASSWORD]` placeholder wasn't replaced, or you copied the "Direct connection" (port 5432) instead of the Transaction pooler (port 6543). Fix it in Render → your service → **Environment** → edit → **Save**, and it redeploys.

**Check:** `/health` shows `"database":"ok"`.

---

## Part F — Create the mobile app (20 min)

From the repo folder (`socal-fishing-app`):

```bash
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo install @maplibre/maplibre-react-native expo-location expo-dev-client react-native-safe-area-context expo-task-manager expo-keep-awake @react-native-async-storage/async-storage @supabase/supabase-js react-native-url-polyfill expo-image-picker expo-image-manipulator expo-file-system expo-document-picker expo-sharing expo-notifications expo-device expo-constants @react-native-community/netinfo fflate expo-image expo-video react-native-webview @expo/vector-icons expo-splash-screen
```

`npx expo install` picks library versions that match your Expo version. Always use it (not plain `npm install`) for app libraries.

If `create-expo-app` made its own Git folder inside `mobile`, remove it so everything stays in one repo:

```bash
rm -rf .git                 # Windows PowerShell: Remove-Item -Recurse -Force .git
```

Copy the starter files over the template (this replaces `App.tsx` and `app.json`):

```bash
cp -R ../mobile-files/. .   # Windows PowerShell: Copy-Item -Recurse -Force ..\mobile-files\* .
```

Now edit two things in VS Code:

1. **`app.json`** — replace both `com.CHANGEME.fishingapp` with a unique ID, all lowercase, no spaces, e.g. `com.cassullo.fishingapp`. Pick it once; it can't change after the app is on the App Store. (The display name "Fishing App" can change anytime.)
2. Create a file **`mobile/.env`** with these lines (your Render URL, and the Supabase values from Part D step 5):

```
EXPO_PUBLIC_API_URL=https://fishing-app-api.onrender.com
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

These are public values; they're safe in the app. Never put the `service_role` key here.

Type-check everything:

```bash
npx tsc --noEmit
```

**Check:** the last command prints nothing (no errors).

---

## Part G — Install it on your iPhone (45 min, mostly waiting)

Needs your Apple Developer account approved.

```bash
npm install -g eas-cli
eas login                    # your Expo account
eas init                     # links this app to your Expo account; answer Yes
eas device:create            # registers your iPhone
```

`eas device:create` shows a QR code/link. Open it **on your iPhone**, install the profile, then:
- Settings → General → **VPN & Device Management** → install the downloaded profile.
- Settings → Privacy & Security → **Developer Mode** → On → restart the phone (iOS 16+).

Build the development app in Expo's cloud:

```bash
eas build --profile development --platform ios
```

- Sign in with your Apple Developer account when asked.
- When it asks to generate certificates/provisioning profiles, answer **Yes** (let Expo manage them).
- The build takes ~15–25 minutes. When done, it shows a QR code — scan it with the iPhone camera and install.

Start the development server on your computer:

```bash
npx expo start --dev-client
```

Open the new app on your iPhone. It finds your computer automatically when both are on the same Wi-Fi (or scan the QR code shown in the terminal).

**You only repeat `eas build` when a new native library is added or `app.json` permissions change.** (If you already built once before the speed/compass/routes/tracks update, run `eas build --profile development --platform ios` one more time — it added background location and three libraries.) Everyday code changes reload on the phone within seconds.

**Check (the Week 1 goal):**
- [ ] The NOAA nautical chart fills the screen around Newport/Catalina
- [ ] Your blue location dot appears; the top panel shows coordinates, SOG (speed, knots), COG (course) and GPS accuracy
- [ ] Drive or walk: SOG rises from 0 and COG appears once you're moving over ~1 kt
- [ ] Compass button shows your heading; tapping it cycles North up → Heading up → Course up
- [ ] Long-press on the water → card with coordinates, distance and bearing; Save spot leaves a cyan dot
- [ ] Tap a spot (amber = public, cyan = yours) → Go to → big navigation panel with distance, bearing, steering, ETA and off-course distance
- [ ] Routes → New route → tap the map a few times → Save; then Go — it switches legs automatically and vibrates on arrival
- [ ] Tracks → Start recording → choose "Allow While Using", then "Change to Always Allow" when iPhone asks → lock the phone, move around, unlock → the cyan line kept growing → Stop and save → it appears in the list with distance, time, max and average speed
- [ ] The ◎ button re-centers on you

---

## Part H — Save your progress to GitHub

From the repo folder:

```bash
git add .
git commit -m "Mobile app running on iPhone"
git push
```

(`.env` files are ignored on purpose — secrets never go to GitHub.)

---

## Part Q — The redesign: Day / Night mode, simpler navigation, App Store ready

### What changed
- **Day mode** (default in daylight): white cards with defined borders, dark text, high contrast in the sun.
- **Night mode**: near-black with dim red/amber text and the chart darkened — no blue light, so it doesn't glare at
  the helm or ruin your night vision. **Auto** (default) switches 20 minutes after sunset and back before sunrise for
  where you are. The **sun/moon button** next to the map's search bar switches instantly; Me → Display sets Auto/Day/Night.
- **5 tabs**: Map · Weather · Spots · Community · Me. "My Fishing" and "Profile" are now inside **Me**, laid out like
  iPhone Settings (Display, My fishing, On the water, Account, About).
- **Map**: search + day/night on top, your speed/course card, and just three controls on the right (Layers, Compass,
  Me). Everything else is behind one **+** button: Log a catch, Save this spot, Send to my crew, Routes, Record a trip,
  Read conditions, Today's report, Weather here.
- Real icons everywhere instead of emoji; consistent headers, buttons and lists on every screen.
- **App Store items**: Delete my account (Me → Account), About links (privacy, terms, support, "Advertise with us"),
  reviewer demo login, app icon/splash placeholders, privacy manifest, iPhone-only. Full guide: `docs/APP_STORE.md`.

### Q-1. Database (1 min)
Supabase → SQL Editor → paste `db/migrations/010_account_deletion.sql` → **Run**.

### Q-2. App (5 min + rebuild)
In your `mobile` folder:
```bash
npx expo install @expo/vector-icons expo-splash-screen
```
Many files changed, so copy the **whole** `mobile-files/` folder over your `mobile` folder again (overwrite everything —
your `.env` isn't in it, so it's kept). On the Mac:
```bash
cp -R ../mobile-files/. .
npx expo prebuild -p ios --clean
```
then redo the Xcode signing step (Team = your Personal Team, remove **Push Notifications** if you're still on the free
account) and press ▶. (`--clean` is needed because the icon, splash and app settings changed.)

Optional `.env` lines for Me → About (see `docs/APP_STORE.md`): `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`,
`EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_STUDIO_URL`, `EXPO_PUBLIC_DEMO_EMAIL`.

### Q-3. Legal & support pages (5 min)
```bash
python tools/build_legal.py "Your App Name" support@yourdomain.com
```
Push to GitHub → Render → Blueprints → sync → `fishing-app-legal` goes live (privacy.html, terms.html, support.html).

**Redesign check:**
- [ ] In daylight the app is white with crisp borders; at night (or tap the moon) it turns dark red and the chart dims
- [ ] Me → Display → Auto / Day / Night all work and the choice is remembered after closing the app
- [ ] Map: + opens the action grid; each tile does what it says; Layers / Compass / Me buttons work
- [ ] Me → Catch log & trips opens your log; "‹ Me" goes back
- [ ] Me → Delete my account on a TEST account removes it (sign-in again creates a fresh empty account)

## Part P — Ad Studio: let businesses upload, preview and pay for ads

The Ad Studio is a separate web app (it installs like an app on a phone) at its own address, e.g.
`https://fishing-app-studio.onrender.com`. Businesses sign in with their email, build an ad, see exactly how it looks
in your app and what it costs, and send it to you. **Nothing runs until you approve it.** You use the same Studio
(signed in as yourself) to review, set the final price, take payment and watch results.

### P-1. Database (2 min)
Supabase → SQL Editor → New query → paste all of `db/migrations/009_ad_platform.sql` → **Run** (needs 008 first).
It also creates the public **ad-media** file bucket. Check: Supabase → **Storage** → you see `ad-media` marked Public.
(If it isn't there: Storage → New bucket → name `ad-media` → Public → Save, then run the file again.)

Make sure your own account is the owner (you did this for the admin console; run it again if unsure — use YOUR email):
```sql
update profiles set is_admin = true where id = (select id from auth.users where email = 'you@example.com');
```

### P-2. Fill in the Studio's settings (3 min)
Open `apps/studio/config.js` in VS Code and fill in:
- `supabaseUrl` and `anonKey` — the same public values as the app's `.env` (Supabase → Project Settings → API)
- `apiUrl` — your Render API address
- `appName` — what advertisers see at the top (change any time)
- `contactEmail` — where advertisers can reach you

Save, then push to GitHub (Part H).

### P-3. Put it online (5 min)
1. Render dashboard → **Blueprints** → your blueprint → **Manual sync** (or **New → Static Site** → your repo →
   Root directory `apps/studio`, Build command *(blank)*, Publish directory `.`).
2. Wait for **Live**, then open the address it shows.

**Check:** the Studio opens with "Advertise to SoCal anglers". Sign in with your email + the 6-digit code →
you land on **Dashboard** (because you're the owner).

### P-4. Set your prices (5 min)
Studio → **Prices**. Starting prices are placeholders — change them to what you want to charge:
| Spot | Starting price / week | Advertisers per week |
| --- | --- | --- |
| Daily report banner | $25 | 4 |
| Catch reports banner | $20 | 4 |
| Forum banner | $15 | 4 |
| App-open sponsor (5 sec, only at the dock) | $75 | 2 |
| "Presented by" Today / Weather / Catch Map / SST Map | $50 / $40 / $40 / $35 | 1 (exclusive) |

Also on that page: multi-week discounts (starts at 4+ weeks 10% off, 12+ weeks 20% off), what one targeted area costs
(40% of the all-SoCal price; several areas never cost more than all of SoCal), and the payment instructions advertisers
see (put your Zelle / Venmo / check details there). Advertisers see "estimated views" based on your real app traffic.

### P-5. Card payments with Stripe (optional, 15 min — skip to accept only Zelle/Venmo/check)
Stripe charges nothing monthly; it keeps a small fee per payment (about 2.9% + 30¢ in the US).
1. Create a free account at **stripe.com**. Stay in **Test mode** (toggle at the top) while you try it.
2. Stripe → **Developers → API keys** → copy the **Secret key** (`sk_test_…`).
3. Render → **fishing-app-api** → **Environment** → add:
   - `STRIPE_SECRET_KEY` = the secret key
   - `SUPABASE_URL` = your Supabase URL, `SUPABASE_ANON_KEY` = the anon public key (lets the API check who's paying)
   - `STUDIO_URL` = your Studio address (where Stripe sends people back)
4. Stripe → **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-API.onrender.com/billing/webhook`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Save → **Reveal signing secret** (`whsec_…`) → add it in Render as `STRIPE_WEBHOOK_SECRET`.
5. Render redeploys by itself. Test: approve a test ad → sign in as the advertiser → **Pay by card** → card number
   `4242 4242 4242 4242`, any future date, any CVC → you're sent back to the Studio and the ad shows **Paid**.
6. When you're ready for real money: Stripe → activate your account (business + bank info) → switch off Test mode →
   repeat steps 2–4 with the **live** keys.

The free Render API sleeps when idle, so the first "Pay by card" click can take ~30 seconds. Stripe re-sends the
payment confirmation automatically if the API was asleep, so nothing is lost.

### P-6. App update (needs a rebuild — new libraries)
In your `mobile` folder:
```bash
npx expo install expo-image expo-video react-native-webview
```
Copy from `mobile-files/` (overwrite): `App.tsx`, `src/ads/` (whole folder), `src/analytics.ts`,
`src/screens/ProfileScreen.tsx`, `src/ads.test.ts`. Then rebuild (Mac: Xcode ▶ after `npx expo prebuild -p ios`;
or a new EAS build). The app now shows every ad type, and tapping an ad can open a website, call, give directions,
or show a coupon (saved under **Profile → Saved coupons**).

### P-7. How it works day to day
**An advertiser:**
1. Opens the Studio link you send them (or a "Advertise with us" link on your site) → signs in with their email.
2. Enters their business info once.
3. **➕ Create an ad** — 5 steps:
   - **Where:** pick a spot (each shows the price and design size).
   - **When & area:** start date, weeks, all of SoCal or chosen areas, optional fishing interests → live price, discount,
     estimated views, and sold-out weeks.
   - **Your ad:** upload a file (PNG/JPG/WebP image, GIF, MP4 video up to 15 s, PDF flyer, or an HTML5 animation .zip
     from Google Web Designer / Adobe Animate / Canva), or **Design in Canva** (it shows the exact size to use), or a
     **Quick ad** (logo + headline + message, no design needed). Then choose what a tap does: website, call, directions,
     coupon code (+ optional coupon PDF). The Studio checks size, shape, length and file size and explains any problem.
   - **Preview:** their ad inside a phone showing your real app screen.
   - **Send:** note to you, agree to the ad rules → **Send for review**.
4. Gets a message and (if they also use the app) a push when you approve or ask for changes.
5. Pays by card, or by the way you listed → watches **Results**: views, daily reach, taps, calls, directions, coupons
   saved, video plays, and which areas saw it. **Print report** and **Invoice** buttons included.

**You:**
- A push on your phone when an ad comes in, an advertiser writes, or a card payment lands.
- **To review** → open it → see the phone preview → change the price/dates if you want → **Approve**, **Ask for
  changes** (with a note), or **Reject**.
- **Mark paid** when a check/Zelle/Venmo arrives (or **Run before payment** for people you trust). Approved + paid ads go
  live automatically on their start date and stop on their end date. **Paused** takes one off right away.
- **Calendar** shows every spot week by week (booked / available). **Money** shows what's owed and paid, with a CSV
  export. **Advertisers** keeps contact info and private notes; **➕ New ad** lets you build an ad for a business yourself
  (e.g. one that emailed you their flyer). If you add a business with its email, the owner is linked automatically when
  they first sign in.

**Install it like an app:** open the Studio in Safari on your iPhone → Share → **Add to Home Screen**.

**Canva one-click import (later):** Canva offers an official connection that would let advertisers pull a design
straight in. It needs Canva to review and approve the app, so for now the Studio shows the exact size and they upload
the downloaded file — same result, one extra step.

**Ad Studio check:**
- [ ] Sign in with a second email (e.g. a Gmail) → set up a test business → make an ad with an image → preview → send
- [ ] Your phone gets "New ad to review" (if push is set up) → Studio → To review → Approve
- [ ] Test business sees "Approved — payment due"; you press **Mark paid** → status becomes Scheduled / Live now
- [ ] On the start date, the ad appears in the app (Today screen for the daily banner); tapping it opens the website
- [ ] A coupon ad shows the code; **Save coupon** puts it under Profile → Saved coupons
- [ ] A few minutes later the test business's **Results** show views and taps
- [ ] (Stripe) Test card payment marks the order Paid by itself

**Database test (optional, computer with PostgreSQL):** `bash db/tests/run_ads_test.sh` runs the whole flow above
against a throwaway database (sign-up, prices, sold-out weeks, privacy between businesses, review, payments, stats).

## Part O — Fishing groups 2: email invites, "Come to me", last known position, float plans

### O-1. Turn on two Supabase extensions (2 min)
Supabase → **Database → Extensions** → search and enable:
1. **pg_net** — lets the database send push notifications itself (free; works even while Render is asleep).
2. **pg_cron** — runs the float-plan overdue check every 5 minutes. (If you did Part M-2 it's already on.)

### O-2. Database (1 min)
Supabase → SQL Editor → New query → paste all of `db/migrations/008_groups_plus.sql` → **Run**.
You should see "Success". If you see a notice that pg_cron isn't enabled, do O-1 and run the file again (safe to repeat).

Check the overdue job is scheduled: run `select jobname, schedule from cron.job;` → you should see
`float-plan-overdue | */5 * * * *`.

### O-3. App (2 min)
Copy these from `mobile-files/` into your `mobile` folder (overwrite): `App.tsx`, `app.json`, `src/tracking.ts`,
`src/community/` (whole folder), `src/components/Buddies.tsx`, `src/components/GroupPins.tsx`, `src/components/SpotCard.tsx`,
`src/components/LogCatchSheet.tsx`, `src/community/catchApi.ts`, `src/screens/CommunityScreen.tsx`, `src/screens/MapScreen.tsx`,
`src/screens/MyFishingScreen.tsx`, `src/layers/LayersSheet.tsx`, `src/groups.test.ts`.
No new libraries. Because `app.json` changed (new background-location wording), **rebuild** the app
(`npx expo run:ios --device` on the Mac, or a new EAS build) instead of just reloading.

In `src/community/groupsApi.ts`, find `https://YOUR-APP-LINK` and replace it with your App Store / TestFlight link once
you have one (it's the link in the invite message).

### O-4. What each piece does
| Feature | How it works |
| --- | --- |
| **Invite by email** | Group → ➕ Invite buddies → type emails. They see the invite (Join / No thanks) when they sign in with that email; if they already have the app they also get a push. Then tap **Send message** to text/email them the download link + code from your own phone (free — no email service needed). The app never reveals whether an email already has an account. |
| **Live / last known** | Purple ▲ = sharing now. Gray ◆ = stopped sharing or lost signal, with "last seen 9:42 AM", for 24 h. Each member can turn "Show my last known position" off, or tap **Stop + hide my spot**. |
| **Come to me** | Map → **📣 Crew** (or the group page) → **Come to me**. Everyone in the group gets a push; tapping it opens the map with **Go To** running to you (bearing, distance, ETA). **Send my position** does the same without the urgency. Max one per minute. |
| **Group-only catches** | When logging a catch, "Also send to my group" sends the **exact** spot to that group only — even if the catch is Private on the public map. Past catches: My Fishing → catch → **Send to group**. |
| **Spots & routes** | Group page → 📌 Share a spot / 🧭 Share a route, or any spot card on the map → **Send to my group**. Members can **Save spot** / **Save route** / **Go to**. |
| **Feed & messages** | One feed per group: pings, positions, catches, spots, routes, messages, check-ins. Updates live. Long-press your own post to delete it. Notifications can be muted per group. |
| **Float plan** | Group page → 🚤 Heading out → back-by time + note. Your boat is shared while the plan is open. Check in (👍 / +1 h / ⚓ heading in / 🏠 back at the dock). **30 min past your back-by time** without "back at the dock": the group gets a push with your last known position and a reminder to try VHF 16 / call the Coast Guard, and you get an "Are you OK?" push. |
| **Background** | While sharing or on a float plan, the phone keeps updating your position with the screen off (low-power: about once a minute / every 0.1 NM) if location is set to **Always**. It stops by itself when sharing ends. |

**Groups check (needs two phones or two accounts):**
- [ ] Phone A creates a group → invites phone B's email → B signs in → sees the invite → Join
- [ ] A: Share 4 h → B sees A's purple boat; A: Stop sharing → B sees a gray "last seen" boat
- [ ] A: 📣 Crew → Come to me → B gets a push → tap → map opens with Go To running to A
- [ ] A logs a catch with "send to group" → B's feed shows it; Go to / Save spot work
- [ ] A starts a float plan "back by" 15 minutes from now, doesn't check in → ~45 min later B gets the overdue push
      (to test faster, in the SQL editor: `update float_plans set back_by = now() - interval '31 minutes';`, wait ≤5 min)
- [ ] Mute the group on B → A's next ping doesn't notify B
- [ ] A stranger account can't see the group, its feed, or anyone's position

**Database test (optional, on a computer with PostgreSQL installed):** `bash db/tests/run_groups_test.sh` runs the
whole scenario above against a throwaway database (invites, privacy, pings, rate limits, catches, float plan, overdue).

## Part N — Weather page + "Can my boat handle it?"

### N-1. Database (1 min)
Supabase → SQL Editor → paste all of `db/migrations/007_weather.sql` → **Run**. (Adds Weather-page views to the
sponsor inventory and the "What they run" boat mix to the media kit. Safe to run twice.)

### N-2. Backend (2 min)
Nothing new to install. Push to GitHub (Part H) → Render redeploys by itself. Then test in PowerShell
(use your Render URL — the first call can take ~30 s if Render was asleep):
```powershell
$u = "https://YOUR-API.onrender.com"
irm "$u/weather?lat=33.585&lon=-117.885&boat_type=center_console&boat_len=23" | ConvertTo-Json -Depth 3 | Select-Object -First 60
irm "$u/weather/history?lat=33.585&lon=-117.885&days=7" | Select-Object -ExpandProperty station
irm "$u/tides/range?lat=33.585&lon=-117.885&begin=2026-07-04&end=2026-07-05" | Select-Object -ExpandProperty hilo
```
You should see `"available": true`, hours with `"rating"` (level/label/reasons), the buoy station, and the 4th of July tides.

| Endpoint | What it returns |
| --- | --- |
| `GET /weather?lat&lon&boat_type&boat_len&comfort&course` | 5-day hourly NWS marine forecast, every hour rated for the boat, daily verdict + best window, sunrise/sunset, moon, NWS alerts, the official marine zone text, nearest buoy now, today's tide |
| `GET /weather/history?lat&lon&days=1..45&station=` | Measured buoy history (wind, gusts, waves, period, water/air temp, pressure) |
| `GET /tides/range?lat&lon&begin&end` | Predicted highs/lows + hourly curve for ANY past or future dates (31 days max per call), plus measured water level when the station has a gauge |
| `GET /weather/boats` | Boat types, comfort levels and the disclaimer |

### N-3. App (1 min)
Copy the new/changed files from `mobile-files/` into your `mobile` folder (overwrite): `App.tsx`,
`src/screens/WeatherScreen.tsx`, `src/weather/` (whole folder), `src/components/TabBar.tsx`,
`src/components/SpotCard.tsx`, `src/screens/MapScreen.tsx`, `src/weather.test.ts`. No new libraries. Reload the app.

### N-4. How the boat rating works (so you can explain it to users and sponsors)
- Each forecast hour gets **🟢 Comfortable / 🟡 Bumpy / 🟠 Rough / 🔴 Stay in** for *your* boat (type, length, how cautious).
- It uses the seas height **and period** (steepness = height ÷ wavelength, wavelength ≈ 5.12 × period² ft), so
  3 ft @ 14 s rates far better than 3 ft @ 5 s. It shows the **2× rule** (period in seconds ≥ 2 × height in feet).
- It can never look better than the NWS: Small Craft Advisory criteria (21–33 kt or hazardous steep seas per NWS
  Western Region) push small boats to Stay in and bigger boats to at least Rough; gale-force wind or a Gale/Storm/
  Hazardous Seas warning = Stay in for everyone. High Surf/Beach Hazards add a harbor-entrance note.
- Optional **Heading toward** changes the rating for seas on the beam (rolling) vs. the bow.
- Every screen says it's planning guidance, not a guarantee, and that NWS warnings come first.

**Weather check:**
- [ ] Weather tab opens on your location (or a harbor if GPS is off); harbor chips switch places
- [ ] "Rated for" → set your boat → ratings change; a kayak shows more red than a 30 ft boat on the same day
- [ ] Tap a day card → hourly list; tap an hour → reasons, 2× rule, steepness
- [ ] Map → tap a spot → **🌤 5-day weather** opens the Weather tab for that spot
- [ ] Past data: 24 h … 45 d charts; switch buoy
- [ ] Tides: ◀ ▶, Today, type `2026-07-04` → Go
- [ ] Airplane mode → Weather shows the last saved forecast labeled as offline
- [ ] Admin → Sponsors → "Presented by" section **Weather** exists; Media kit shows "What they run"

## Part M — App metrics & the business side of the admin console

### M-1. Database (2 min)
Supabase → SQL Editor → paste all of `db/migrations/006_analytics_admin.sql` → **Run**.

### M-2. Turn on the nightly clean-up (2 min, optional)
Supabase → **Database → Extensions** → enable **pg_cron**. Then in the SQL Editor run:
```sql
select cron.schedule('metrics-nightly', '30 9 * * *',
  $$select refresh_metrics_range(la_day(now()) - 2, la_day(now()) - 1); select purge_old_events();$$);
```
(The hourly Alerts job already refreshes today's and yesterday's numbers; this is a backup.)

### M-3. Use it
Admin console → **Overview**. Click **Recompute numbers** once. Everything after that updates by itself.

| Tab | What you get |
| --- | --- |
| **Overview** | Live: active right now, today, weekly and monthly users, stickiness, installs, accounts, sessions and session length, catches, reports, groups, boats sharing, alert subscribers, forum, sponsor impressions + CTR, moderation backlog. Charts over 30/90/180/365 days. |
| **Audience** | Areas (coarse), iPhone vs Android, app versions, phone vs tablet, signed-in share, busiest hours and weekdays, **retention** (do new people come back on day 1, week 2, day 30). |
| **Engagement** | Every feature (times + people), screens, most-used map layers, species logged, species interest. |
| **Ads & reports** | Sellable inventory per sponsor slot (views/month), impressions/clicks/CTR by placement, per-campaign report (daily chart, reach, areas, screens) and a **printable report to send the sponsor**. |
| **Media kit** | One page with your live audience numbers + your prices → **Print / Save as PDF** → email it to tackle shops, landings, brands. |
| **Users** | Search accounts; give/remove Verified badge, suspend/unsuspend, make/remove admin (all audited). |
| **Broadcast** | Push a message to everyone (max 1 per 24 h). |
| **Settings** | Ads on/off, sponsor intro on/off, maintenance banner, "please update" minimum version, analytics on/off; type in **store downloads**/ratings from App Store Connect and Play Console (or paste CSV); export daily metrics as CSV. |

### M-4. Where "downloads" come from
The app can only count **first opens** (installs that were actually opened). True **store downloads** live in
**App Store Connect → Analytics/Trends** and **Google Play Console → Statistics**. Copy them into Settings → Store numbers
weekly (or paste CSV); the Overview and media kit then show both. (Automatic import from the stores' reporting APIs can be
added later.)

### M-5. App rebuild
These changes use libraries already installed in Part L — reload the app. The **Profile** tab now has a
"Share anonymous usage stats" switch (on by default; people can turn it off).

**Metrics check:**
- [ ] Use the app for a few minutes (open layers, view a spot, log a catch), wait ~1 minute, then admin → Overview →
      Recompute: today's active users, sessions and features show up
- [ ] Audience shows your area (e.g. Orange County) — never coordinates
- [ ] Profile → turn off usage stats → new activity stops counting
- [ ] Media kit prints a clean one-page PDF

## Part L — Batch 4: MPAs & hazards, offline pack, import/export, Today, sponsors, alerts, admin console

### L-1. Database (2 min)
Supabase → SQL Editor → New query → paste all of `db/migrations/005_alerts_admin.sql` → **Run**.

### L-2. Rules & hazards data (10 min)
1. GitHub → Actions → **Ocean data** → Run workflow → job `rules`.
2. Open the run log. For each layer you'll see `N features` or `FAILED …` / `not configured`.
   - **MPAs**: if it fails, the California Fish & Wildlife link moved. Search **data.ca.gov** for "Marine Protected Areas"
     (CDFW, dataset ds582), open the **ArcGIS REST / FeatureServer** link, copy the URL ending in `/FeatureServer/0`,
     and add it under **Settings → Secrets and variables → Actions → Variables** as `MPA_URL`. Run `rules` again.
   - **Wrecks / buoys / lanes** come from NOAA's chart service (found automatically by layer name). If it fails, set
     `ENC_SERVICE_URL` to the current NOAA "ENC Direct to GIS" MapServer URL (from nauticalcharts.noaa.gov → GIS data).
   - **Federal closures** (Cowcod areas, rockfish depth lines) and **Mexican reserves**: set `CLOSURES_URL` /
     `MEXICO_MPA_URL` once you've found the official GeoJSON or ArcGIS layer. Until then they show "not configured".
3. The app downloads these with the offline pack. Check the **Data health** page in the admin console for the date.

### L-3. Alerts (10 min)
1. GitHub → repo **Settings → Secrets → Actions**: add `DATABASE_URL` (same as Render) and `NWS_USER_AGENT`.
2. Push alerts need the build to know your Expo project: `eas init` (Part G) writes `extra.eas.projectId` into
   `app.json` — make sure it's no longer `SET-BY-eas-init`.
3. Actions → **Alerts** → Run workflow once; the log should say `nothing to send` or `sent N notifications`.
   After that it runs every hour by itself.
4. On the phone: **Profile → Alerts** → allow notifications → add an alert.

### L-4. Admin console (10 min)
1. Render → **New → Blueprint** (or **Sync** if you already used the blueprint) → it adds `fishing-app-admin`
   (a free static site from `apps/admin`).
2. Open its URL → paste your Supabase URL, the **anon public** key and your API URL → sign in with your email code.
   (Your account needs `is_admin = true` — Part K step 2.)
3. Tabs: **Moderation** (queue + remove/hide/restore + suspend), **Spots** (add/correct/disable, source + license
   required), **Categories**, **Sponsors** (advertisers, campaigns, impressions/clicks/CTR), **Announcements**
   (show on Today), **Data health** (is NOAA still updating?), **Audit log**.

### L-5. First sponsor (optional, 5 min)
Admin console → Sponsors → add an advertiser → new campaign → placement `presented_by`, section `Today`, a logo URL
(https), dates, Create. Open the app → **Today**: "Presented by …" appears; impressions count up in the console.

### L-6. New app libraries
Rebuild the app once (Part G, or `npx expo run:android`) — this batch adds files, sharing, notifications and network libraries.

**Batch 4 check:**
- [ ] Layers → Rules & hazards: MPAs show (red = no take, amber = limited); tap one for its rule, regs link and check date
- [ ] Wrecks, navigation buoys, shipping lanes and anchorages show when "Wrecks, buoys…" is on
- [ ] Drive/simulate a route into an MPA → phone vibrates, red banner "You're in … — No take" (can't dismiss while inside)
- [ ] Pin or Log catch inside a no-take area → warning first
- [ ] Profile → **Offline maps** → Update now → chart, ocean, rules, tides and spots all show "Ready"/dates
- [ ] Airplane mode → map still shows chart + relief, rules, your spots; tap water → tide from the saved pack;
      orange "Offline" chip at the top
- [ ] Layers → **Save this area offline** → extra chart detail saved (listed under Offline maps)
- [ ] Spots → **Import GPX / KML** → preview, duplicates flagged, Import adds to a folder (nothing overwritten);
      **Export GPX** opens the share sheet
- [ ] **Today** opens once a day at the dock: catches by species, hot areas (3+ anglers), activity, water, warnings, buoys
- [ ] With a campaign: "Presented by" on Today / Catch Map / SST bar; 5-second intro at app open only when stopped
- [ ] Alerts: add one; the hourly job sends at most 4 a day

## Part K — Catch Map, community and groups (Batch 3)

1. Supabase → SQL Editor → New query → paste all of `db/migrations/004_community.sql` → **Run**.
   It adds the forum, comments, likes, blocking, moderation, rate limits, auto-verification, photo storage
   buckets and the buddy-boat function. (If an older run already created part of it, send Claude any red error.)
2. Make yourself the moderator: Supabase → **Table Editor** → `profiles` → your row (sign in once first) →
   set `is_admin` to **true** → Save. Moderators see reported items and can run, in the SQL editor:
   `select moderate('post', '<post id>', 'removed', 'spam');`  ·  `select suspend_user('<user id>', now() + interval '7 days', 'harassment');`
   (`'visible'` restores something; every action is written to `audit_log`.)
3. The new app libraries (camera/photos) need one more phone build: rerun the build step (Part G, or
   `npx expo run:android` on the virtual phone).

**Batch 3 check:**
- [ ] Map → **🎣 Log** → pick species, technique, bait, add a camera photo, choose **Approximate** → Save
- [ ] With airplane mode on, log another catch → "will send when you're back in range" → turn signal on → it sends by itself
- [ ] **My Fishing** shows both catches with the conditions saved (water temp, tide, moon …); filters work; Show on map works
- [ ] The public catch shows on the Catch Map (map bar: 6 h … 30 days, species chips) — at a fuzzed spot, not where you were
- [ ] Tap a cluster → summary (typical size, what's working, water temp) and the reports
- [ ] Sign in a second account on another phone/emulator: it sees the public report but can never see the private one
- [ ] **Community → Forum**: post, comment, like; long-press a comment → Report / Block
- [ ] **Community → My groups**: create a group, join it from the second account with the code, **Share my boat** →
      each sees the other's boat (purple ▲) on the map with its age; **Stop sharing** removes it

## Part J — Sign-in by email code (5 min)

The app signs people in with a 6-digit code sent by email (no passwords, no links to tap).

1. Supabase → **Authentication** → **Sign In / Providers** → make sure **Email** is enabled.
2. Supabase → **Authentication** → **Emails** (or **Email Templates**) → **Magic Link** template. Replace the body with:

```
<h2>Your sign-in code</h2>
<p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
<p>If you didn't ask for it, ignore this email.</p>
```

   Click **Save**.
3. Test: app → **Profile** tab → enter your email → **Email me a code** → type the code → **Sign in**.

Supabase's built-in email sender is limited to a few emails per hour, fine for testing. Before launch, connect a free
email service (e.g. Resend) under **Authentication → Emails → SMTP Settings**.

**Batch 2 check (after Part I has produced data):**
- [ ] Tabs at the bottom: Map, Spots, Community, My Fishing, Profile (Community and My Fishing say "In the next update")
- [ ] **Search** bar on the map finds the DEV TEST SPOT and your saved spots (your spots work offline too)
- [ ] **Layers** → water temperature shows over the chart; **See-through** 25–100% changes it
- [ ] Temperature breaks draw as white lines (thick = strong); green dashed lines for chlorophyll edges
- [ ] Time bar: Latest / 24 h / 48 h / 3 days / 7 days, ▶ plays them in order, **Hold: 3 d ago** flips while held,
      and the date + age is always shown (amber when old)
- [ ] Seafloor relief (amber = steep drop-offs) and depth contours
- [ ] Radar shows rain and **Loop last hour** animates it; wind arrows change with the forecast-hour chips
- [ ] Buoys: tap one for measured wind, waves and water temp
- [ ] **Probe**: a crosshair appears; drag the map and the panel shows coordinates, water temp, nearby break, depth
- [ ] Tap a spot or long-press water: the card now lists full conditions with each value's source
- [ ] **Profile → Data sources** lists every source with its latest date

## Optional — run the navigation-math tests

```bash
cd mobile
npx expo install jest-expo jest @types/jest -- --save-dev
```

Add to `mobile/package.json`:

```json
"scripts": { "test": "jest" },
"jest": { "preset": "jest-expo" }
```

(merge `"test"` into the existing `"scripts"` block), then run `npm test`. All test files (navigation math, analytics, batch 4, weather) should pass.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Chart area is blank/gray, map moves fine | NOAA's chart service may be down or updating (they update Fridays) — try again later. The chart comes from NOAA's Maritime Chart Service (`NOAA_CHART_TILES` in `mobile/src/config.ts`); NOAA retired the older `NOAACharts …/tile` cache, so don't switch back to it. |
| Top panel says "Location off" | iPhone Settings → Privacy & Security → Location Services → Fishing App → **While Using**. |
| `eas build` fails on credentials | Make sure the Apple Developer membership shows "Active" at developer.apple.com/account, then rerun. |
| App can't find the dev server | Phone and computer on the same Wi-Fi; or run `npx expo start --dev-client --tunnel`. |
| Render deploy fails | Open Render → Logs; the last red lines name the problem. Paste them to Claude. |
| `git push` rejected | Run `git pull --rebase origin main`, then `git push`. |
| Track stops when the screen locks | iPhone Settings → the app → Location → **Always**. Without it, tracks record only while the app is open. |
| Compass jumps around | Normal near engines, metal and electronics. The phone asks to calibrate sometimes — move it in a figure 8. Underway, trust COG over the compass. |
| SOG shows 0 at the dock | Intentional: tiny GPS drift below 0.3 kt is shown as 0 so it doesn't look like you're moving. |

---

## Part I — Ocean & weather data (Batch 1: SST, temperature breaks, chlorophyll, seafloor, tides, weather, buoys)

The backend now has a daily job that downloads NOAA satellite data for SoCal, finds temperature breaks and
chlorophyll edges, draws map tiles, and stores them in **Cloudflare R2** (free up to 10 GB; tiles for SoCal are ~10–20 MB/day).
**GitHub Actions** runs it twice a day for free.

### I-1. Add the new data sources to the database (2 min)
Supabase → SQL Editor → New query → paste all of `db/seeds/003_data_sources_ocean.sql` → **Run**.

### I-2. Create the free tile storage on Cloudflare R2 (10 min)
1. Sign up at https://dash.cloudflare.com/sign-up (free).
2. Left sidebar → **R2 Object Storage** → **Create bucket** → name it `fishing-app-data` → **Create bucket**.
   (R2 may ask for a card even on the free tier; you won't be charged under 10 GB.)
3. Open the bucket → **Settings** → **Public access** → **R2.dev subdomain** → **Allow Access** → type `allow`.
   Copy the URL it shows, like `https://pub-abc123.r2.dev`. This is your **PUBLIC_DATA_URL**.
4. Back on the R2 overview page → **Manage R2 API Tokens** (right side) → **Create API token**:
   - Name: `fishing-app-pipeline` · Permissions: **Object Read & Write** · Specify bucket: `fishing-app-data` → **Create**.
   - Copy **Access Key ID**, **Secret Access Key**, and the **endpoint** for S3 clients
     (`https://<account-id>.r2.cloudflarestorage.com`). You only see the secret once.

### I-3. Give GitHub the keys (5 min)
GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, add each:

| Name | Value |
| --- | --- |
| `R2_BUCKET` | `fishing-app-data` |
| `R2_ENDPOINT` | the endpoint from I-2 step 4 |
| `R2_ACCESS_KEY_ID` | from I-2 step 4 |
| `R2_SECRET_ACCESS_KEY` | from I-2 step 4 |
| `PUBLIC_DATA_URL` | the r2.dev URL from I-2 step 3 |

### I-4. First run — check NOAA's dataset names, then process (15 min, mostly waiting)
1. Repo → **Actions** tab → **Ocean data** (left) → **Run workflow** → job: `verify` → **Run workflow**.
2. Open the run when it finishes. You want `OK` next to `sst`, `chl` and `bathy`.
   - **If one says FAIL:** run the workflow again with job `discover`. It lists NOAA's current dataset names.
     Paste that list to Claude and you'll get the right name back. Put it under **Settings → Secrets and variables →
     Actions → Variables** as `SST_DATASET` or `CHL_DATASET`, then run `verify` again.
3. Run the workflow with job `all`, then once more with job `wind`. The first run takes 10–20 minutes (it also builds the seafloor layer once).
   After that it runs by itself: ocean data at about 7:20 AM and 7:20 PM Pacific, wind four times a day.

**Check:** in Cloudflare → R2 → your bucket you see folders `tiles/`, `vectors/`, `grids/`, `manifests/`.

### I-5. Point the API at the tiles (5 min)
Render → your service → **Environment** → add `STORAGE` = `r2` and the same five R2 values as I-3 → **Save**
(it redeploys). Then test in PowerShell (use your Render URL):

```powershell
$api = "https://fishing-app-api.onrender.com"
Invoke-RestMethod "$api/layers" | ConvertTo-Json -Depth 6
Invoke-RestMethod "$api/conditions?lat=33.45&lon=-118.0" | ConvertTo-Json -Depth 8
Invoke-RestMethod "$api/buoys" | ConvertTo-Json -Depth 4
```

**Check:** `/conditions` returns water temp, any nearby temperature break, chlorophyll, depth, tide (with station and
distance), wind, buoy waves and moon — each with its source and age. A section with `"ok": false` says why (e.g. a
spot outside NWS forecast grids); that's expected, not a crash.

### Optional — run the job on your own PC
```powershell
cd C:\dev\socal-fishing-app\api
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m tests.run                 # 55 tests should pass
python -m ocean.jobs verify
python -m ocean.jobs all            # writes to .\data
uvicorn main:app --reload           # then open http://localhost:8000/layers
```

### Better seafloor detail (optional, later)
The default seafloor layer uses NOAA's global model (~1.8 km). For banks and canyons in sharp detail, download NOAA's
**Southern California Coastal Relief Model** GeoTIFF from https://www.ncei.noaa.gov/products/coastal-relief-model,
`pip install rasterio`, then run `python -m ocean.jobs bathy --file path\to\file.tif` once.

---

## What's next (Week 2–3)

Week 2: coordinate-format setting, measure tool, layer panel with opacity. Week 3: fishing-spot importer (GPX/KML/KMZ, licensed data only) and search wired to `/spots/search`. See the build plan doc for the full backlog.

Planned features (automatic data updates, editable rules, admin alerts, over-the-air updates, chart cache, crowd-sourced depth) are written up in [`docs/ROADMAP.md`](docs/ROADMAP.md).
