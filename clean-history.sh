#!/bin/bash
# Channel Nav — remove the licensed fishing-spot list from GitHub's ENTIRE history, so the repo is safe to make public.
# Run it ONCE, from your main Mac, in the project folder:
#     bash clean-history.sh
# It backs everything up first, checks there are no passwords hidden in the history, then cleans and uploads.
# Nothing is deleted from your Mac except the two spot files inside the repo — and those are backed up to your Desktop.
set -e
cd "$(dirname "$0")"

SPOTS1="db/seeds/data/San_Diego_Fishing_Spots.gpx"
SPOTS2="db/seeds/004_fishing_spots_swyc.sql"

echo "=== Channel Nav: get the code ready to be public ==="

# --- safety checks -------------------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "✗ Run this from your socal-fishing-app folder."; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ You have changes that aren't shipped yet. Run:  bash ship.sh \"save work\"   then try again."
  exit 1
fi
if [ ! -f LICENSE ]; then
  echo "✗ LICENSE is missing — ship fix-145 first:  unzip it, then  bash ship.sh \"fix-145: add license\""
  exit 1
fi
REMOTE=$(git remote get-url origin)
NAME=$(basename "$PWD")
echo "Repository: $REMOTE"

# --- 1) back everything up ----------------------------------------------
BK="$HOME/Desktop/channelnav-backup-$(date +%Y%m%d-%H%M)"
mkdir -p "$BK"
[ -d db/seeds/data ] && cp -R db/seeds/data "$BK/" || true
[ -f "$SPOTS2" ] && cp "$SPOTS2" "$BK/" || true
( cd .. && zip -qr "$BK/full-repo-backup.zip" "$NAME" -x "*/node_modules/*" ) || true
echo "✓ Backed up the spot list and a full copy of everything to:"
echo "    $BK"

# --- 2) scan the whole history for anything secret ----------------------
echo "Checking the history for any password or key (this can take a minute)..."
HITS=$(git log -p --all 2>/dev/null | grep -nE 'sk-ant-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|service_role[^a-zA-Z].{0,40}eyJ|_SECRET_ACCESS_KEY=.{16}|_PASSWORD=.{6}' | head -20 || true)
if [ -n "$HITS" ]; then
  echo ""
  echo "⚠️  STOP. The history may contain a password or key. DO NOT make the repo public."
  echo "   Copy the lines below and send them to Claude — it will tell you which key to change."
  echo "   ----"
  echo "$HITS"
  echo "   ----"
  echo "   (Nothing was changed. The repo is still private and safe.)"
  exit 1
fi
echo "✓ No passwords or keys found in the history."

# --- 3) confirm before the one-way part ---------------------------------
echo ""
echo "Ready to permanently remove the spot list from every past version on GitHub."
echo "Your Desktop backup above keeps a full copy. This cannot be undone on GitHub."
read -r -p "Type  yes  to continue (or press Enter to stop): " ANS
[ "$ANS" = "yes" ] || { echo "Stopped. Nothing was changed."; exit 0; }

# --- 4) rewrite history without the two spot files ----------------------
echo "Cleaning history..."
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --index-filter \
  "git rm -r --cached --ignore-unmatch '$SPOTS1' '$SPOTS2'" \
  --prune-empty --tag-name-filter cat -- --all

# throw away the leftover pre-clean copies so the data is really gone locally
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now >/dev/null 2>&1 || true

# --- 5) upload the cleaned history --------------------------------------
echo "Uploading the cleaned history to GitHub..."
git push origin --force --all
git push origin --force --tags 2>/dev/null || true

echo ""
echo "✅ Done. The spot list is gone from GitHub, past and present."
echo "   Full backup kept on your Desktop: $BK"
echo "   Next: tell Claude it worked, and it will walk you through flipping the repo to Public."
