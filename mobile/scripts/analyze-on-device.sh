#!/bin/bash
# Analyse a video file with the installed Boing app on a connected Android device or emulator,
# and print the app's result (JSON). The video is served over HTTP from this computer; the app
# downloads it (apps can't read files pushed with adb). The pose model downloads on first use.
#
#   scripts/analyze-on-device.sh <video.mp4> [timeout seconds]
#
# Works for the emulator and for a phone on USB: `adb reverse` makes the computer's port reachable
# as localhost on the device.
set -euo pipefail
VIDEO=$1
TIMEOUT=${2:-900}
ADB=${ADB:-adb}
PORT=${PORT:-8765}
PKG=info.ljungqvist.boing
DIR=$(cd "$(dirname "$VIDEO")" && pwd)
NAME=$(basename "$VIDEO")

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

"$ADB" reverse tcp:$PORT tcp:$PORT > /dev/null
"$ADB" logcat -c
"$ADB" shell am start -W -a android.intent.action.VIEW -d "boing://analyze?url=http://localhost:$PORT/$NAME" "$PKG" > /dev/null

start=$(date +%s)
while true; do
  line=$("$ADB" logcat -d -s ReactNativeJS:V | grep "BOING_FILE" | tail -1 || true)
  if [[ -n $line ]]; then
    echo "${line#*BOING_FILE }"
    break
  fi
  if (( $(date +%s) - start > TIMEOUT )); then
    echo "timeout; last app log lines:" >&2
    "$ADB" logcat -d -s ReactNativeJS:V | tail -20 >&2
    exit 1
  fi
  sleep 3
done
