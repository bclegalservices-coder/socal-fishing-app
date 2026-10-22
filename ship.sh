#!/bin/bash
# Channel Nav — ship your changes.  Run from the socal-fishing-app folder:
#     bash ship.sh "what you changed"
# 0) checks the app code first — a mistake stops here, before anything reaches phones
# 1) saves everything to GitHub (the server and daily jobs update themselves from there; GitHub re-checks it too)
# 2) sends the app part to every installed phone as an over-the-air update (no App Store review)
# Something went wrong after shipping?  bash rollback.sh
set -e
cd "$(dirname "$0")"
MSG="${1:-Small fixes}"
# The app folder: "mobile" or "mobile-files", whichever this project has.
APPDIR=$(for d in mobile mobile-files; do [ -f "$d/app.json" ] && echo "$d" && break; done)
[ -n "$APPDIR" ] || { echo "Can't find the app folder (mobile or mobile-files)."; exit 1; }

# A change to these two files needs a new App Store / TestFlight build, not just an update.
NATIVE=$(git status --porcelain "$APPDIR/package.json" "$APPDIR/app.json" 2>/dev/null | wc -l | tr -d ' ')

echo "1/4  Checking the app code..."
CFG=.; [ -f "$APPDIR/tsconfig.check.json" ] && CFG=tsconfig.check.json
if (cd "$APPDIR" && npx --yes -p typescript tsc --noEmit -p "$CFG" > /tmp/channelnav-tsc.txt 2>&1); then
  echo "     looks good"
else
  echo "     ✗ Found problems in the app code:"
  head -20 /tmp/channelnav-tsc.txt | sed 's/^/       /'
  echo ""
  echo "     Copy the lines above to Claude. Shipping now could break the app on phones."
  read -r -p "     Ship anyway? Type yes to continue, or just press Enter to stop: " ANSWER
  [ "$ANSWER" = "yes" ] || { echo "     Stopped. Nothing was shipped."; exit 1; }
fi

echo "2/4  Saving to GitHub..."
git add -A
git commit -m "$MSG" >/dev/null && echo "     saved: $MSG" || echo "     (nothing new to save)"
git push

echo "3/4  Sending the app update to every phone..."
if [ "$NATIVE" != "0" ]; then
  echo "     ⚠ app.json or package.json changed. Phones need a NEW BUILD for that part (TestFlight / cable)."
fi
cd "$APPDIR"
npx eas-cli@latest update --channel production --message "$MSG" --non-interactive

echo "4/4  Done."
echo ""
echo "Shipped. Phones download it the next time the app opens and use it the time after."
echo "If an update crashes before its first screen appears, phones automatically go back to the last version that worked."
echo "Problem after shipping?  bash rollback.sh   ·   Turn one feature off fast: Admin → Settings → Emergency off-switches"
