#!/bin/bash
# Builds pico, installs it on a connected iPhone and launches it.
# usage: app/run-device.sh [device name or UDID]   (default: the first paired physical iPhone)
# Debug builds save *_API_KEY variables from ../.env to the device Keychain on first launch.
# PICO_AUTOPROMPT="..." runs one prompt in a new session. Engine log: Library/Caches/engine.log in the app container.
set -e
cd "$(dirname "$0")"
device="${1:-$(xcrun devicectl list devices 2>/dev/null | grep -E 'iPhone.*physical' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1)}"
[ -n "$device" ] || { echo "no paired iPhone found"; exit 1; }
(cd ../runtime && node build.mjs >/dev/null)
xcodegen generate --quiet
xcodebuild -project Pico.xcodeproj -scheme Pico -destination "id=$device" -derivedDataPath build/DerivedData -allowProvisioningUpdates build -quiet 2>&1 | grep -E "error:" || true
xcrun devicectl device install app --device "$device" build/DerivedData/Build/Products/Debug-iphoneos/Pico.app >/dev/null
set -a; [ -f ../.env ] && . ../.env; set +a
env_json=$(node -e 'const e={};for(const [k,v] of Object.entries(process.env)) if((k.endsWith("_API_KEY")&&k!=="PICO_API_KEY")||k==="PICO_AUTOPROMPT") if(v) e[k]=v; console.log(JSON.stringify(e))')
xcrun devicectl device process launch --device "$device" --terminate-existing --environment-variables "$env_json" com.etuleu.pico | tail -1
