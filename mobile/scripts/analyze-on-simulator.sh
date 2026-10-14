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

RESULT="$(xcrun simctl get_app_container "$SIM" "$APP" data)/Documents/boing-file-result.json"
rm -f "$RESULT"
xcrun simctl openurl "$SIM" "boing://analyze?url=http://localhost:$PORT/$NAME"

start=$(date +%s)
until [[ -s $RESULT ]]; do
  if (( $(date +%s) - start > TIMEOUT )); then
    echo "timeout after $TIMEOUT s" >&2
    exit 1
  fi
  sleep 3
done
cat "$RESULT"
echo
