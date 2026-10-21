#!/usr/bin/env bash
# Build for the simulator, install on an existing simulator, launch, and save a screenshot.
# Usage: run-sim.sh [--config <path>] [launch args...]   e.g. run-sim.sh -uiTesting -demo
# Simulator: capture.runSimulator, else capture.devices.iphone.simulator, else "iPhone 17".
# Writes build/shots/screen.png; on a two-display phone (iPhone Duo) also inner.png while it is open.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = "--config" ]; then export SHIPFAST_CONFIG="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2; fi
cfg() { node "$HERE/lib/config.mjs" "$1"; }

ROOT="$(cfg ROOT)"
PROJECT="$ROOT/$(cfg xcode.project)"
SCHEME="$(cfg xcode.scheme)"
BUNDLE="$(cfg app.bundleId)"
SIM="$(cfg capture.runSimulator 2>/dev/null || cfg capture.devices.iphone.simulator 2>/dev/null || echo 'iPhone 17')"
export DEVELOPER_DIR="$(cfg xcode.developerDir 2>/dev/null || echo /Applications/Xcode-27.1.app/Contents/Developer)"

# Use the existing simulator; never create one (each takes 4-6 GB).
U=$(xcrun simctl list devices available -j | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const all = Object.values(JSON.parse(s).devices).flat().filter((d) => d.name === process.argv[1]);
  const pick = all.find((d) => d.state === "Booted") ?? all[0];
  if (pick) console.log(pick.udid);
});' "$SIM")
[ -n "$U" ] || { echo "No simulator named \"$SIM\". Use the existing one; don't create one." >&2; exit 1; }

mkdir -p "$ROOT/build/shots"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -sdk iphonesimulator -configuration Debug \
  -derivedDataPath "$ROOT/build/dd" -clonedSourcePackagesDirPath "$ROOT/build/spm" build CODE_SIGNING_ALLOWED=NO \
  > "$ROOT/build/sim-build.log" 2>&1 || { grep -E "error:" "$ROOT/build/sim-build.log" | head -30; exit 1; }
APP=$(ls -d "$ROOT"/build/dd/Build/Products/Debug-iphonesimulator/*.app | grep -v -i test | head -1)
xcrun simctl boot "$U" 2>/dev/null || true
xcrun simctl install "$U" "$APP"
xcrun simctl terminate "$U" "$BUNDLE" 2>/dev/null || true
xcrun simctl launch "$U" "$BUNDLE" "$@" >/dev/null
sleep "${WAIT:-7}"
xcrun simctl io "$U" screenshot --display=primary "$ROOT/build/shots/screen.png" >/dev/null 2>&1 || true
rm -f "$ROOT/build/shots/inner.png"
xcrun simctl io "$U" screenshot --display=primary-1 "$ROOT/build/shots/inner.png" >/dev/null 2>&1 || true
echo "built $APP on $SIM; shots in build/shots (screen.png, and inner.png on an open iPhone Duo)"
