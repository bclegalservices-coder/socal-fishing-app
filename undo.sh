#!/bin/bash
# Channel Nav — take back one fix completely and ship the version from before it.
# Run from the socal-fishing-app folder:
#     bash undo.sh fix-140
# What it does:
#   1) finds every save on GitHub whose message starts with that fix name (e.g. "fix-139: ...")
#   2) reverses just those changes (everything shipped before or after it stays)
#   3) ships the result with ship.sh (server + daily jobs from GitHub, app update to every phone)
# Changed your mind again?  bash undo.sh "undo fix-140"   (undoes the undo)
# Faster, no shipping: for fix-140 (new maps) you can also tick "OLD MAPS" in Admin → Settings → Emergency off-switches.
set -e
cd "$(dirname "$0")"
# Run from a copy, because undoing a fix can change or remove this very file.
if [ -z "$UNDO_COPY" ]; then
  T=$(mktemp /tmp/channelnav-undo.XXXXXX)
  cp "$0" "$T"
  UNDO_COPY=1 exec bash "$T" "$@" "$(pwd)"
fi
FIX="$1"
cd "${2:-.}"
if [ -z "$FIX" ]; then
  echo "Which fix should be undone? Example:  bash undo.sh fix-139"
  echo "Recent saves:"; git log --format='  %s' -12
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "You have changes that aren't shipped yet (maybe a zip you just unpacked). Ship them first with"
  echo "  bash ship.sh \"what changed\""
  echo "or ask Claude. Nothing was changed."
  exit 1
fi
git pull --quiet >/dev/null 2>&1 || true
COMMITS=$(git log --format=%H -E --grep="^${FIX}([: ]|$)")
if [ -z "$COMMITS" ]; then
  echo "Couldn't find a save named \"$FIX\". Recent saves:"; git log --format='  %s' -12
  exit 1
fi
N=$(echo "$COMMITS" | wc -l | tr -d ' ')
echo "Undoing $FIX ($N save(s)):"
git log --format='  %h %s' $COMMITS --no-walk
BEFORE=$(git rev-parse HEAD)
if ! git revert --no-edit $COMMITS >/dev/null 2>&1; then
  git revert --abort 2>/dev/null || true
  echo "✗ A later fix changed the same lines, so it can't be undone automatically. Nothing was changed."
  echo "  Send this message to Claude and it will make an undo zip for you."
  exit 1
fi
# keep undo.sh itself
if ! git cat-file -e HEAD:undo.sh 2>/dev/null && git cat-file -e "$BEFORE:undo.sh" 2>/dev/null; then
  git show "$BEFORE:undo.sh" > undo.sh && git add undo.sh && git commit --quiet --amend --no-edit
fi
git reset --soft "$BEFORE" >/dev/null
echo "Shipping the version without $FIX..."
bash ship.sh "undo $FIX"
