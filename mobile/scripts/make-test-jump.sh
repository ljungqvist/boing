#!/bin/bash
# Makes test videos of a known jump without filming one: MediaPipe's own test photo of a person
# (full body, feet visible), moved along a free-fall parabola. Flight time 0.4948 s at g = 9.81,
# so both heights (takeoff→apex and flight time) are 30.0 cm. Timing only matters, but the
# pixel scale is chosen so the implied g is plausible too (stature 1.75 m).
#
#   scripts/make-test-jump.sh <output dir>
#
# Writes jump-upright.mp4 (stored upright) and jump-rotated.mp4 (stored sideways with a 90°
# display rotation, as phones store portrait videos). 720×1280 at 60 fps, 5 s, jump at 2 s.
set -euo pipefail
OUT=${1:?output dir}
mkdir -p "$OUT"
IMG="$OUT/pose.jpg"
[[ -s $IMG ]] || curl -sSfL -o "$IMG" https://storage.googleapis.com/mediapipe-assets/pose.jpg

# Crop around the person (1000×667 photo) and scale to 720 wide: nose→heel ≈ 456 px.
SCALE=1.2857
PX_PER_M=$(python3 -c "print(456 / (0.92 * 1.75))")
T0=2.0
T=0.4948
V0=$(python3 -c "print(9.81 * $T / 2)")
Y=600 # top of the person layer in the 1280-high frame (feet near the bottom)
DY="if(between(t,$T0,$T0+$T),$PX_PER_M*($V0*(t-$T0)-4.905*(t-$T0)*(t-$T0)),0)"

ffmpeg -v error -y -f lavfi -i "color=c=0xd8c8a8:s=720x1280:r=60:d=5" -loop 1 -framerate 60 -i "$IMG" \
  -filter_complex "[1:v]crop=560:467:220:200,scale=720:-2[p];[0:v][p]overlay=x=0:y='$Y-($DY)':shortest=1:eval=frame,format=yuv420p" \
  -t 5 -r 60 -c:v libx264 -preset veryfast -crf 18 "$OUT/jump-upright.mp4"

# Same frames stored turned 90° counter-clockwise (1280×720), displayed upright by the rotation
# metadata (a display matrix of 90° clockwise, like an iPhone's portrait video).
ffmpeg -v error -y -i "$OUT/jump-upright.mp4" -vf "transpose=2" -c:v libx264 -preset veryfast -crf 18 "$OUT/sideways.mp4"
ffmpeg -v error -y -display_rotation:v:0 -90 -i "$OUT/sideways.mp4" -c copy "$OUT/jump-rotated.mp4"
rm "$OUT/sideways.mp4"
echo "$OUT/jump-upright.mp4 $OUT/jump-rotated.mp4"
