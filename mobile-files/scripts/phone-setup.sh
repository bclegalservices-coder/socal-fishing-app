#!/bin/bash
# Channel Nav: get the app ready to install on a real iPhone with a FREE Apple ID.
#   bash scripts/phone-setup.sh        (run from the mobile folder)
# 1) sets the app name, icon and launch screen   2) rebuilds the iOS project
# 3) removes push notifications from the build (free Apple IDs can't sign them; they come back with the $99 account)
set -e
cd "$(dirname "$0")/.."

if ! grep -q '"updates"' app.json; then
  echo "⚠  Over-the-air updates aren't set up yet. Run this first:  bash scripts/ota-setup.sh"
  echo "   (Without it, this phone could never receive fixes without a cable.)"
  exit 1
fi

echo "1/3  Setting name, icon and launch screen..."
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
const e = j.expo;
e.name = "Channel Nav";
e.icon = "./assets/icon.png";
if (!e.ios.bundleIdentifier || e.ios.bundleIdentifier.includes("CHANGEME")) e.ios.bundleIdentifier = "com.cassullo.channelnav";
if (!e.android.package || e.android.package.includes("CHANGEME")) e.android.package = "com.cassullo.channelnav";
for (const p of e.plugins) {
  if (Array.isArray(p) && p[0] === "expo-splash-screen") {
    Object.assign(p[1], { image: "./assets/splash-icon.png", imageWidth: 180, backgroundColor: "#0B2A40" });
    p[1].dark = { image: "./assets/splash-icon.png", backgroundColor: "#06182A" };
  }
}
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
console.log("     name:", e.name, "| bundle id:", e.ios.bundleIdentifier);
'

echo "2/3  Rebuilding the iOS project (2-5 minutes)..."
npx expo prebuild -p ios --clean

echo "3/3  Removing push notifications from this free build..."
find ios -name "*.entitlements" -print0 | while IFS= read -r -d "" f; do
  /usr/libexec/PlistBuddy -c "Delete :aps-environment" "$f" 2>/dev/null && echo "     cleaned $f" || true
done

echo ""
echo "Ready. Next: plug in your iPhone, then run:"
echo "   npx expo run:ios --device --configuration Release"
