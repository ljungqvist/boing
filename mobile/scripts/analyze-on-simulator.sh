#!/bin/bash
# Analyse a video file with the Boing app installed on a booted iOS simulator, and print the app's
# result (JSON). The video is served over HTTP from this Mac (the simulator shares its localhost);
# the app downloads it and writes the result to its Documents/boing-file-result.json (iOS release
# builds don't log). The pose models download on first use.
#
#   scripts/analyze-on-simulator.sh <video.mp4> [timeout seconds]
set -euo pipefail
VIDEO=$1
TIMEOUT=${2:-900}
SIM=${SIM:-booted}
PORT=${PORT:-8765}
APP=info.ljungqvist.boing
DIR=$(cd "$(dirname "$VIDEO")" && pwd)
NAME=$(basename "$VIDEO")

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

DOCS="$(xcrun simctl get_app_container "$SIM" "$APP" data)/Documents"
RESULT="$DOCS/boing-file-result.json"
LOG="$DOCS/boing-test-log.txt" # the app's status lines while testing
rm -f "$RESULT" "$LOG"
xcrun simctl openurl "$SIM" "boing://analyze?url=http://localhost:$PORT/$NAME"
sleep 15
if [[ ! -s $LOG ]]; then
  # Usually iOS asking "Open in Boing?": approve the scheme before booting (see .github/workflows/ios.yml).
  echo "the link didn't reach the app; screen text:" >&2
  SHOT=$(mktemp -t boing).png
  xcrun simctl io "$SIM" screenshot "$SHOT" > /dev/null 2>&1
  swift "$(dirname "$0")/ocr.swift" "$SHOT" >&2 || true
  exit 1
fi

start=$(date +%s)
until [[ -s $RESULT ]]; do
  if (( $(date +%s) - start > TIMEOUT )); then
    echo "timeout after $TIMEOUT s; app status lines:" >&2
    cat "$LOG" >&2 2>/dev/null || echo "(none: the link never reached the app)" >&2
    xcrun simctl spawn "$SIM" launchctl list 2>/dev/null | grep -i "$APP" >&2 || echo "(the app is not running)" >&2
    exit 1
  fi
  sleep 3
done
cat "$LOG" >&2 2>/dev/null || true
cat "$RESULT"
echo
