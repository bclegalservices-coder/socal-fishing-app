# Getting on the App Store — checklist

Everything Apple asks for, in order, with this app's answers filled in. Budget: the $99/yr Apple Developer Program
and about one evening, plus 1–3 days of Apple review.

---

## 1. Before you submit (the app itself)

- [ ] **Final name and icon.** Edit `"name"` in `mobile/app.json` (what shows under the icon, ≤ 30 characters) and
      replace `mobile/assets/icon.png` (1024 × 1024 PNG, **no transparency**, no rounded corners — Apple rounds it).
      `assets/splash-icon.png` is the launch logo. The current ones are placeholders.
- [ ] **Bundle ID** is set (`com.cassullo.fishingapp` or yours) — it can never change after the first upload.
- [ ] **Version** `1.0.0`. Build numbers go up by themselves with `eas build` (set in eas.json).
- [ ] **`.env` filled in** — API, Supabase, plus the About links:
  ```
  EXPO_PUBLIC_PRIVACY_URL=https://fishing-app-legal.onrender.com/privacy.html
  EXPO_PUBLIC_TERMS_URL=https://fishing-app-legal.onrender.com/terms.html
  EXPO_PUBLIC_SUPPORT_EMAIL=support@yourdomain.com
  EXPO_PUBLIC_STUDIO_URL=https://fishing-app-studio.onrender.com
  EXPO_PUBLIC_DEMO_EMAIL=appreview@yourdomain.com
  ```
- [ ] **Legal pages online:** `python tools/build_legal.py "Your App Name" support@yourdomain.com`, push to GitHub,
      Render → sync blueprint → `fishing-app-legal` is live. Open privacy.html and support.html on your phone.
- [ ] **Account deletion works** (Apple rejects apps without it): run `db/migrations/010_account_deletion.sql`, then
      Me → Delete my account on a test account.
- [ ] **Demo account for Apple's reviewer** (they can't receive your email codes):
  1. Supabase → Authentication → Users → **Add user** → email `appreview@yourdomain.com`, a password, **Auto Confirm**.
  2. Put that email in `EXPO_PUBLIC_DEMO_EMAIL`. Typing that exact email in the app shows a password box instead of
     "Email me a code". Everyone else still gets codes.
  3. Sign in once as the reviewer, join a test group, log one catch, so screens aren't empty.
- [ ] **Push notifications:** with the paid account, in Xcode → Signing & Capabilities → **+ Capability → Push
      Notifications** (you removed it for free testing), or let EAS manage it.
- [ ] Test on a real iPhone in **Day and Night**, signed in and signed out, with airplane mode on (offline maps).

## 2. Build and upload

Easiest: Expo's cloud (no Xcode archive needed).
```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile production     # ~20 min; answer Yes to let Expo manage certificates
eas submit --platform ios --latest                 # uploads to App Store Connect
```
(On the Mac you can instead do Xcode → Product → Archive → Distribute App → App Store Connect.)

The build shows up in **App Store Connect → your app → TestFlight** after processing (10–30 min). Install it through
TestFlight on your phone and on a buddy's — that's your final test.

## 3. App Store Connect — the listing

**App Store Connect → Apps → +  New App** → iOS, name, primary language English (U.S.), your bundle ID, SKU (any, e.g.
`fishingapp1`).

| Field | Suggested answer |
| --- | --- |
| Subtitle (30) | `SoCal fishing map & ocean data` |
| Category | Primary **Navigation**, secondary **Sports** (or Weather) |
| Price | Free |
| Promotional text (170) | `Water temperature breaks, live catch reports, NOAA charts and a boat-rated 5-day marine forecast — free for Southern California anglers.` |
| Keywords (100) | `fishing,saltwater,tuna,yellowtail,sst,chart,tides,marine,weather,boat,navigation,catalina,socal` |
| Support URL | `https://fishing-app-legal.onrender.com/support.html` |
| Marketing URL | optional |
| Privacy Policy URL | `https://fishing-app-legal.onrender.com/privacy.html` |
| Copyright | `2026 Cassullo LLC` (or your company) |

**Description** (edit freely):
```
The Southern California fishing map — free.

• NOAA nautical charts with water-temperature breaks, chlorophyll edges, seafloor relief and contours
• Live catch reports from local anglers (you choose how precise your own are — or keep them private)
• 5-day marine forecast that rates every hour for YOUR boat: Comfortable, Bumpy, Rough or Stay in
• Go To, routes, trip tracks, speed, course and compass — and it keeps working offshore with no signal
• Marine protected areas, wrecks, buoys and shipping lanes, with alerts when you enter a no-take zone
• Your crew: share positions, "Come to me", catches and spots with your fishing group; float plans with overdue alerts
• Day and red-light Night mode for running in the dark

Fishing and navigation assistance only. Not a certified chartplotter — keep a proper lookout and use official charts.
```

**Screenshots** (required): iPhone **6.9"** (1320 × 2868) — 3 to 10 images. Take them on a large iPhone (or the
simulator "iPhone 16 Pro Max"): Map with SST + breaks, Weather with boat ratings, Catch Map, Crew group, Night mode.
Day mode screenshots read best in the store.

**App Review Information:**
- Sign-in required: **Yes** → the demo email and password from step 1.
- Notes (paste and adjust):
  ```
  Sign in: type the demo email in Me → Sign in; a password field appears (regular users get a 6-digit email code).
  Background location ("Always") is used only while the user records a trip track or chooses to share their boat
  position with their private fishing group / float plan; both are started by the user and end on their own.
  Ads are our own direct sponsorships (no ad networks, no tracking, no IDFA).
  User-generated content: report and block are on every post and catch report; reports are reviewed within 24 h.
  Account deletion: Me → Delete my account.
  ```

**Age rating:** answer the questionnaire honestly. User-generated content (forum) with moderation and no mature
themes usually gives **12+**.

**App Privacy ("nutrition labels")** — Data collected:
| Data | Linked to the user? | Used for | Tracking? |
| --- | --- | --- | --- |
| Email address | Yes | App functionality (sign-in) | No |
| Precise location | Yes | App functionality (catches you log, positions you share, float plans) | No |
| Coarse location | No | Analytics, local sponsors ("Orange County") | No |
| Photos | Yes | App functionality (catch photos) | No |
| Other user content (posts, catch reports) | Yes | App functionality | No |
| Product interaction | No | Analytics | No |
| Device ID (random app install ID) | No | Analytics | No |
"Do you or your third-party partners use data for tracking?" → **No**. (No App Tracking Transparency prompt needed.)

**Export compliance:** handled — `usesNonExemptEncryption: false` is in app.json (standard HTTPS only).

## 4. Submit

Pick the build → **Add for Review** → **Submit**. Typical review: 1–3 days. Common first-time rejections and fixes:
- *Guideline 2.1 – couldn't sign in* → double-check the demo account/password.
- *5.1.1(v) – account deletion* → already in Me.
- *2.5.4 – background location* → the review note above explains it; keep "Always" only for track/sharing (it is).
- *4.0 – design / 4.2 minimum functionality* → not an issue for an app this size.

## 5. After launch

- Turn **Stripe** to live keys (Ad Studio), set real ad prices, send the Studio link to local shops.
- Every update: raise `version` in app.json for user-visible releases, `eas build` → `eas submit` → "What's New" text → Submit.
- Watch **App Store Connect → Analytics** and the admin console's Overview.
