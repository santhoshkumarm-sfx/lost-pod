#!/usr/bin/env bash
# Installs a FULL "POD lost" package over your project folder, so nothing from an earlier update can be left
# behind or half-applied. Run from your project folder (e.g. /workspaces/lost-pod):
#
#   unzip -o pod-lost-full-*.zip -d /tmp/pod-lost-pkg && bash /tmp/pod-lost-pkg/INSTALL.sh
#
# Keeps your secrets (setup.env, .env.local), git history and node_modules.
set -euo pipefail

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pod-lost"
DEST="$PWD"
if [ ! -f "$PKG/package.json" ]; then echo "✗ Package folder not found next to INSTALL.sh"; exit 1; fi
if [ ! -f "$DEST/package.json" ] || [ ! -d "$DEST/.git" ]; then echo "✗ Run this from your project folder (the one with package.json and .git)"; exit 1; fi
VERSION="$(sed -n "s/.*APP_VERSION = '\(.*\)'.*/\1/p" "$PKG/src/lib/version.ts")"
echo "== Installing POD lost version $VERSION into $DEST"

echo "== 1/6 Removing old update folders and zips"
rm -rf "$DEST"/lost-pod-update "$DEST"/lost-pod-update*.zip "$DEST"/pod-lost-full*.zip

echo "== 2/6 Removing files that are no longer part of the app"
git -C "$DEST" ls-files -z | while IFS= read -r -d '' f; do
  if [ ! -e "$PKG/$f" ]; then echo "   - $f"; git -C "$DEST" rm -q --cached -- "$f" >/dev/null; rm -f -- "$DEST/$f"; fi
done

echo "== 3/6 Copying every file of the package"
cp -a "$PKG/." "$DEST/"

echo "== 4/6 Installing packages and checking the code"
npm install --no-audit --no-fund
npx tsc --noEmit -p .
npx vitest run --reporter=dot

echo "== 5/6 Database and Vercel (npm run setup -- --skip-sync)"
if [ "${POD_LOST_SKIP_SETUP:-}" = 1 ]; then echo "   (skipped)"; else npm run setup -- --skip-sync; fi

echo "== 6/6 Saving to git"
git add -A
git commit -q -m "POD lost $VERSION (full package)" || echo "   (nothing new to commit)"
git push || echo "   ✗ git push failed — run 'git push' yourself"

echo
echo "✓ Done. The menu (bottom left) and <your site>/api/version should both say: $VERSION"
