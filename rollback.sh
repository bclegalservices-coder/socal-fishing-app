#!/bin/bash
# Channel Nav — undo the last app update you shipped (phones go back to the previous version).
# Run from the socal-fishing-app folder:   bash rollback.sh
# It asks which version to go back to: pick the one just BEFORE the bad update (or "the version built into the app").
set -e
cd "$(dirname "$0")"
cd "$(for d in mobile mobile-files; do [ -f "$d/app.json" ] && echo "$d" && break; done)"
echo "Undoing an app update. Choose the channel 'production', then the version to go back to."
echo ""
npx eas-cli@latest update:rollback || {
  echo ""
  echo "If that didn't work, this lists your recent updates:"
  echo "  (in your app folder) npx eas-cli@latest update:list --branch production"
  echo "then copy the GROUP id of the last good one and run:"
  echo "  npx eas-cli@latest update:republish --group PASTE_GROUP_ID"
}
echo ""
echo "Phones switch back the next time the app opens. Then fix the problem and ship again with: bash ship.sh \"fix\""
