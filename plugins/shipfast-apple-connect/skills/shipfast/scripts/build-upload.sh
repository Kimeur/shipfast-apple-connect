#!/usr/bin/env bash
# Archive the app (and its extensions), sign it for the App Store with the profiles from signing.mjs,
# and upload it to App Store Connect. The build number is one more than the highest in App Store Connect.
#
# Usage: build-upload.sh [--config <path>] [--no-upload]
#   --no-upload  stop after build/export/<scheme>.ipa
#
# Needs: build/sign/ from signing.mjs (signing.keychain-db, keychain.pass, <bundleId>.mobileprovision per target),
# the API key in ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH or ship.local.json.
#
# Why archive unsigned and sign at export: a Swift package target (RevenueCat's, for one) refuses a forced
# provisioning profile, so signing settings on the archive fail. The export signs every target with its own profile.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NO_UPLOAD=0
# --config is passed on to the node helpers through SHIPFAST_CONFIG.
while [ $# -gt 0 ]; do
  case "$1" in
    --config) export SHIPFAST_CONFIG="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --config=*) v="${1#--config=}"; export SHIPFAST_CONFIG="$(cd "$(dirname "$v")" && pwd)/$(basename "$v")"; shift ;;
    --no-upload) NO_UPLOAD=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
cfg() { node "$HERE/lib/config.mjs" "$1"; }
step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

ROOT="$(cfg ROOT)"
PROJECT="$ROOT/$(cfg xcode.project)"
SCHEME="$(cfg xcode.scheme)"
TEAM="$(cfg team.teamId)"
export DEVELOPER_DIR="$(cfg xcode.developerDir 2>/dev/null || echo /Applications/Xcode-27.1.app/Contents/Developer)"
OUT="$ROOT/build"            # gitignored
SIGN="$ROOT/$(cfg signing.dir 2>/dev/null || echo build/sign)"
KC="$SIGN/signing.keychain-db"
[[ "$TEAM" == *REPLACE_ME* ]] && die "set team.teamId in ship.config.json"
[ -d "$PROJECT" ] || die "Xcode project not found: $PROJECT"
[ -f "$KC" ] && [ -f "$SIGN/keychain.pass" ] || die "signing keychain missing in $SIGN: run signing.mjs first"

# Targets: bundle ID → profile name. Default: the app alone.
TARGETS_JSON="$(cfg targets 2>/dev/null || true)"
[ -n "$TARGETS_JSON" ] || TARGETS_JSON="[{\"bundleId\":\"$(cfg app.bundleId)\",\"profileName\":\"$(cfg app.name) App Store\"}]"

# Install each profile under its UUID, where Xcode looks for it.
PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILES"
PROFILE_DICT=""
while IFS=$'\t' read -r BID PNAME; do
  FILE="$SIGN/$BID.mobileprovision"
  [ -f "$FILE" ] || die "missing $FILE: run signing.mjs --only=profiles"
  UUID=$(security cms -D -i "$FILE" | plutil -extract UUID raw -o - -)
  cp "$FILE" "$PROFILES/$UUID.mobileprovision"
  PROFILE_DICT+="<key>$BID</key><string>$PNAME</string>"
done < <(node -e 'for (const t of JSON.parse(process.argv[1])) console.log(`${t.bundleId}\t${t.profileName}`)' "$TARGETS_JSON")

# Build number: one more than the highest build already in App Store Connect.
BUILD=$(node --input-type=module -e "
import { all } from '$HERE/lib/util.mjs';
import { get } from '$HERE/lib/config.mjs';
const id = get('app.appId');
if (!id) { console.log(1); process.exit(0); }
const { data } = await all('/v1/builds?filter[app]=' + id + '&limit=200&fields[builds]=version');
console.log(Math.max(0, ...data.map((b) => Number(b.attributes.version) || 0)) + 1);
") || die "could not read the last build number from App Store Connect"

# The signing keychain joins the search list only while we build; the original list comes back on exit.
ORIG=()
while IFS= read -r k; do ORIG+=("$(echo "$k" | sed 's/^[[:space:]]*"//; s/"$//')"); done < <(security list-keychains -d user)
restore() { security list-keychains -d user -s "${ORIG[@]}"; }
trap restore EXIT
security list-keychains -d user -s "$KC" "${ORIG[@]}"
security unlock-keychain -p "$(cat "$SIGN/keychain.pass")" "$KC"

ARCHIVE="$OUT/$SCHEME.xcarchive"
step "Archive build $BUILD, unsigned (the export signs it)"
mkdir -p "$OUT"
rm -rf "$ARCHIVE" "$OUT/export"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -derivedDataPath "$OUT/archive-dd" CURRENT_PROJECT_VERSION="$BUILD" CODE_SIGNING_ALLOWED=NO \
  archive > "$OUT/archive.log" 2>&1 || { grep -E "error:" "$OUT/archive.log" | head; die "archive failed (build/archive.log)"; }

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>$TEAM</string>
<key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>provisioningProfiles</key><dict>$PROFILE_DICT</dict>
<key>uploadSymbols</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
step "Export and sign"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" > "$OUT/export.log" 2>&1 || { tail -20 "$OUT/export.log"; die "export failed (build/export.log)"; }
IPA=$(ls "$OUT"/export/*.ipa | head -1)
echo "   $IPA ($(du -h "$IPA" | cut -f1)), build $BUILD"

[ "$NO_UPLOAD" = 1 ] && exit 0
step "Upload"
# Read the three values NUL-separated: no eval, so nothing in them can run as shell code.
CREDS=()
while IFS= read -r -d '' v; do CREDS+=("$v"); done < <(node --input-type=module -e "
import { credentials } from '$HERE/lib/asc.mjs';
const c = credentials();
process.stdout.write([c.keyId, c.issuerId, c.keyPath].join('\\0') + '\\0');
")
[ "${#CREDS[@]}" = 3 ] || die "could not read the API key settings"
KEY_ID="${CREDS[0]}"; ISSUER="${CREDS[1]}"; KEY_PATH="${CREDS[2]}"
# altool looks for AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys.
mkdir -p "$HOME/.appstoreconnect/private_keys"
[ -f "$HOME/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8" ] || cp "$KEY_PATH" "$HOME/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8"
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$KEY_ID" --apiIssuer "$ISSUER"
step "Uploaded build $BUILD. Apple processes it in about 10 minutes; then run submit.mjs"
