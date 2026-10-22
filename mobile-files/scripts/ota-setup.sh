#!/bin/bash
# Channel Nav: turn on over-the-air updates (run ONCE, before the iPhone build).
#   bash scripts/ota-setup.sh        (run from the mobile folder)
# Installs Expo's update receiver into the app, links the app to your free Expo account, and points the app at the
# "production" update channel. After this, `bash ship.sh "message"` sends app fixes to every installed phone.
set -e
cd "$(dirname "$0")/.."

echo "1/4  Installing the update receiver (expo-updates)..."
npx expo install expo-updates

echo "2/4  Log in to your free Expo account (make one at https://expo.dev/signup if you don't have one)..."
npx eas-cli@latest whoami >/dev/null 2>&1 || npx eas-cli@latest login

echo "3/4  Linking this app to your Expo account..."
node -e '
const fs = require("fs"); const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
if (j.expo.extra?.eas?.projectId === "SET-BY-eas-init") delete j.expo.extra.eas.projectId;
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");'
npx eas-cli@latest init
[ -f eas.json ] || cat > eas.json <<'JSON'
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "local" },
  "build": { "production": { "channel": "production" } }
}
JSON

echo "4/4  Turning on updates in the app settings..."
node -e '
const fs = require("fs"); const j = JSON.parse(fs.readFileSync("app.json", "utf8")); const e = j.expo;
const id = e.extra?.eas?.projectId;
if (!id) { console.error("No Expo project id found. Run this script again and answer yes when it asks to create the project."); process.exit(1); }
e.runtimeVersion = { policy: "appVersion" };
e.updates = { url: `https://u.expo.dev/${id}`, enabled: true, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0,
              requestHeaders: { "expo-channel-name": "production" } };
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
console.log("     Updates on. Project:", id);'
echo ""
echo "Done. Next: bash scripts/phone-setup.sh"
