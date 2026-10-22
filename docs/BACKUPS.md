# Backups, crash reports & uptime alerts

## Nightly database backup (GitHub → Cloudflare R2)
Runs every night at 3:17 AM Pacific (`.github/workflows/backup.yml`). Keeps 30 daily + 12 monthly copies in your
R2 bucket under `backups/db/`. Each file is **encrypted** with your passphrase, so nobody can read it even if they
found the file.

**One-time setup**
1. Make up a long passphrase (e.g. 5 random words). Write it down somewhere safe (password manager). **Without it a
   backup cannot be opened.**
2. GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret →
   Name `BACKUP_PASSPHRASE`, Value = your passphrase.
3. Actions tab → "Database backup" → Run workflow. It should turn green in 1–3 minutes.

It uses the `DATABASE_URL` and `R2_*` secrets you already have.

**Restoring (only if something went very wrong)**
1. Cloudflare → R2 → your bucket → `backups/db/` → download the newest `.gpg` file.
2. On your Mac: `brew install gnupg libpq` then
   `gpg -d channelnav-YYYY-MM-DD.tgz.gpg > b.tgz && tar xzf b.tgz`
3. `/opt/homebrew/opt/libpq/bin/pg_restore --no-owner --clean --if-exists -d "YOUR_DATABASE_URL" app.dump`
   (ask Claude to walk you through it — do it on a copy first if you can).

Photos in Supabase Storage are not in this backup.

## Uptime alerts
`.github/workflows/uptime.yml` checks every hour: the API and database, water temp / chlorophyll / wind
freshness, and the chart helper. Problem → a GitHub issue "🚨 Channel Nav problem" (GitHub emails you).
Fixed → it closes itself. Make sure GitHub → your avatar → Settings → Notifications → "Issues" email is on.

## Crash reports & feedback
The app sends JavaScript crashes and Me → "Send feedback" messages to the API. See them in the admin console →
**Feedback & crashes**. Copy a crash's details into a chat with Claude to get a fix, ship it, then press "Mark fixed".
Native (Xcode-level) crashes show in Xcode → Window → Organizer → Crashes once the app is on TestFlight.
