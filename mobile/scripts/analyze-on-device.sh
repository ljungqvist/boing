#!/bin/bash
# Analyse a video file with the installed Boing app on a connected Android device or emulator,
# and print the app's result (JSON). The app must be installed; the pose model downloads on first use.
#
#   scripts/analyze-on-device.sh ../../data/own/20261013_174604.mp4 [timeout seconds]
set -euo pipefail
VIDEO=$1
TIMEOUT=${2:-900}
ADB=${ADB:-adb}
PKG=info.ljungqvist.boing
DIR=/sdcard/Android/data/$PKG/files
NAME=$(basename "$VIDEO")

"$ADB" shell mkdir -p "$DIR"
"$ADB" push "$VIDEO" "$DIR/$NAME" > /dev/null
"$ADB" logcat -c
"$ADB" shell am start -W -a android.intent.action.VIEW -d "boing://analyze?path=$DIR/$NAME" "$PKG" > /dev/null

start=$(date +%s)
while true; do
  line=$("$ADB" logcat -d -s ReactNativeJS:V | grep -E "BOING_FILE|Error:" | tail -1 || true)
  if [[ $line == *BOING_FILE* ]]; then
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
"$ADB" shell rm -f "$DIR/$NAME"
