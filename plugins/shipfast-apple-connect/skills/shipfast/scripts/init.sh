#!/usr/bin/env bash
# Set up ship/ in an app repo from the templates. Never overwrites an existing file.
# Usage: init.sh <app-folder>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$HERE/../templates"
APP="${1:?usage: init.sh <app-folder>}"
[ -d "$APP" ] || { echo "not a folder: $APP" >&2; exit 2; }
mkdir -p "$APP/ship"
copy() { if [ -e "$APP/ship/$2" ]; then echo "  kept   ship/$2"; else cp "$T/$1" "$APP/ship/$2"; echo "  added  ship/$2"; fi; }
copy ship.config.example.json ship.config.json
copy ship.local.example.json ship.local.json
copy listing.example.mjs listing.mjs
copy review-notes.example.txt review-notes.txt

# Keep secrets and private details out of git.
GI="$APP/.gitignore"
touch "$GI"
for line in "build/" "ship/ship.local.json" "*.p8" "*.p12" "*.mobileprovision"; do
  grep -qxF "$line" "$GI" || { echo "$line" >> "$GI"; echo "  .gitignore += $line"; }
done
echo "Next: fill ship/ship.config.json, ship/ship.local.json and ship/listing.mjs, then run doctor.mjs --offline."
