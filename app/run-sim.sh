#!/bin/bash
# Builds pico, installs it on a simulator and launches it. Extra env: PICO_AUTOPROMPT="..." runs one prompt.
# usage: app/run-sim.sh [simulator name]   (default: iPhone 17 Pro)
set -e
cd "$(dirname "$0")"
name="${1:-iPhone 17 Pro}"
sim=$(xcrun simctl list devices available | grep -F "$name (" | head -1 | grep -oE '[0-9A-F-]{36}')
(cd ../runtime && node build.mjs >/dev/null)
xcodegen generate --quiet
xcodebuild -project Pico.xcodeproj -scheme Pico -destination "id=$sim" -derivedDataPath build/DerivedData build -quiet 2>&1 | grep -E "error:" || true
xcrun simctl boot "$sim" 2>/dev/null || true
xcrun simctl bootstatus "$sim" -b >/dev/null
xcrun simctl terminate "$sim" com.etuleu.pico 2>/dev/null || true
xcrun simctl install "$sim" build/DerivedData/Build/Products/Debug-iphonesimulator/Pico.app
set -a; [ -f ../.env ] && . ../.env; set +a
SIMCTL_CHILD_DEEPINFRA_API_KEY="$DEEPINFRA_API_KEY" SIMCTL_CHILD_PICO_AUTOPROMPT="$PICO_AUTOPROMPT" xcrun simctl launch "$sim" com.etuleu.pico
echo "$sim"
