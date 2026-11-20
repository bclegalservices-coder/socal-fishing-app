#!/bin/bash
# Channel Nav — hide your name and email from every save in the project, past and future, before going public.
# Run once, from your main Mac, in the project folder:
#     bash scrub-email.sh
set -e
cd "$(dirname "$0")"
echo "=== Channel Nav: hide your email from the project history ==="

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "✗ Run this from your socal-fishing-app folder."; exit 1; }

# save this script if it is the only unsaved change, so the history tool can run on a clean project
if [ -n "$(git status --porcelain)" ]; then
  OTHER=$(git status --porcelain | grep -v 'scrub-email.sh' || true)
  if [ -z "$OTHER" ]; then
    git add scrub-email.sh >/dev/null 2>&1 && git commit -q -m "add email scrub script" >/dev/null 2>&1 || true
  fi
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ You have changes that aren't saved yet. Run:  bash ship.sh \"save work\"   then try again."; exit 1
fi

OWNER=$(git remote get-url origin | sed -E 's#.*github\.com[:/]([^/]+)/.*#\1#')
NEW_NAME="$OWNER"
NEW_EMAIL="$OWNER@users.noreply.github.com"
OLD=$(git log -1 --format='%an <%ae>')
echo "Replacing the name and email on every save with GitHub's private address:"
echo "    $NEW_NAME <$NEW_EMAIL>"
echo "  (currently: $OLD)"
read -r -p "Type  yes  to continue (or press Enter to stop): " ANS
[ "$ANS" = "yes" ] || { echo "Stopped. Nothing changed."; exit 0; }

echo "Rewriting history..."
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --env-filter "
export GIT_AUTHOR_NAME='$NEW_NAME'
export GIT_AUTHOR_EMAIL='$NEW_EMAIL'
export GIT_COMMITTER_NAME='$NEW_NAME'
export GIT_COMMITTER_EMAIL='$NEW_EMAIL'
" --tag-name-filter cat -- --all

rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now >/dev/null 2>&1 || true

# make FUTURE saves use the private address too (so ship.sh never stamps your email again)
git config user.name "$NEW_NAME"
git config user.email "$NEW_EMAIL"

echo "Uploading..."
git push origin --force --all
git push origin --force --tags 2>/dev/null || true

echo ""
echo "✅ Done. Your email is no longer on any save, past or future."
echo "   Tell Claude it worked, and it will give you the final step to make the repo public."
