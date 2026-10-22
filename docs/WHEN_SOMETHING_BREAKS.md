# When something breaks — Channel Nav playbook

## What protects the app automatically
| Problem | What happens on its own |
|---|---|
| One map layer (wind, radar, harbors, ocean) throws an error | Only that layer disappears; the map keeps working; you get a crash report |
| A screen crashes | "Something went wrong · Try again" page instead of a dead app; crash report sent |
| The app closes during startup (native map crash) | Next launch resets map layers to defaults and reports which layers were on |
| Server sends a bad tile address | The app refuses to load it (bad addresses crashed the map engine before) |
| Server is slow or stuck | Every download gives up after 30 s; saved data is shown, marked as old |
| An over-the-air update crashes before its first screen appears | Phones go back to the last version that worked |
| Server falls asleep (Render free plan) | Chart helper pings it every 10 minutes |
| Server, database or daily data jobs fail | GitHub opens an issue "🚨 Channel Nav problem" and emails you; it closes itself when fixed |
| Database lost or damaged | Nightly encrypted backup in R2 (docs/BACKUPS.md) |
| You push code with a mistake | `ship.sh` stops before sending it to phones; GitHub "Checks" re-tests every push |

## What you do, fastest first
1. **One feature is broken for everyone** → Admin console → Settings → **Emergency off-switches** → tick it.
   Phones turn it off within ~10 minutes. No update needed.
2. **The last app update broke something** → `bash rollback.sh` (pick the version before the bad one).
3. **Find out what's wrong** → Admin → **Feedback & crashes** → Crashes → Copy → paste to Claude.
4. **Server problem** → GitHub issue "🚨 Channel Nav problem" says what failed. Render dashboard → Logs.
5. **Fix shipped** → `bash ship.sh "fix ..."`, untick the off-switch, press "Mark fixed" on the crash.
