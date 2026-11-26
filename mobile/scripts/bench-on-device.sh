#!/bin/bash
# Time the re-measurement (`analyzeVideo`) on a connected Android device for several settings, on one video
# file. The video is served from this computer over `adb reverse`; the app downloads it and runs every case
# `repeat` rounds (cases interleaved). Prints one JSON line per run (BOING_BENCH).
#
#   scripts/bench-on-device.sh <video.mp4> '<cases JSON>' [timeout seconds]
#
# cases: [case, …] or {"repeat": 3, "cases": [case, …]}. A case: {"name": "heavy gpu", "model": "heavy"|"full"|"lite", "gpu": true, "perFrame": true,
#          "maxSide": 1280, "cpuHelpers": 0, "from": 1.2, "to": 3.6}   (from/to: seconds on the file's timeline)
# PKG=info.ljungqvist.boing (default) or info.ljungqvist.boing.dev (its links start with boing-dev://).
set -euo pipefail
VIDEO=$1
CASES=$2
TIMEOUT=${3:-3600}
ADB=${ADB:-adb}
PORT=${PORT:-8765}
PKG=${PKG:-info.ljungqvist.boing}
SCHEME=boing
[[ $PKG == *.dev ]] && SCHEME=boing-dev
DIR=$(cd "$(dirname "$VIDEO")" && pwd)
NAME=$(basename "$VIDEO")

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

ENC=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$CASES")
"$ADB" reverse tcp:$PORT tcp:$PORT > /dev/null
"$ADB" logcat -c
"$ADB" shell am start -W -a android.intent.action.VIEW -d "'$SCHEME://bench?url=http://localhost:$PORT/$NAME&cases=$ENC'" "$PKG" > /dev/null

start=$(date +%s)
seen=0
while true; do
  lines=$("$ADB" logcat -d -s ReactNativeJS:V | grep -o 'BOING_BENCH .*' || true)
  n=$(printf '%s' "$lines" | grep -c . || true)
  if (( n > seen )); then
    printf '%s\n' "$lines" | tail -n $((n - seen)) | sed 's/^BOING_BENCH //'
    seen=$n
  fi
  if printf '%s' "$lines" | grep -q '"done":true\|"error"'; then break; fi
  if (( $(date +%s) - start > TIMEOUT )); then
    echo "timeout" >&2
    exit 1
  fi
  sleep 5
done
