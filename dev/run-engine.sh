#!/bin/bash
# Runs the pico engine in pico-cli with commands from a JSONL file; keeps stdin open for <seconds>.
# usage: dev/run-engine.sh <seconds> <commands.jsonl>   (output: /tmp/engine.out, /tmp/engine.err)
set -e
dev="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$dev/../.env"; set +a
export PICO_HEADLESS=1 PI_CODING_AGENT_DIR="$dev/agent" PICO_SESSIONS_DIR="$dev/sessions" PICO_WORKSPACE="$dev/work" PICO_PLATFORM="macOS (pico-cli)"
mkdir -p "$dev/work"
( cat "$2"; sleep "$1" ) | "$dev/../host/.build/debug/pico-cli" --bundle "$dev/../runtime/dist" --script "$dev/../runtime/dist/engine.js" --cwd "$dev/work" > /tmp/engine.out 2> /tmp/engine.err || true
