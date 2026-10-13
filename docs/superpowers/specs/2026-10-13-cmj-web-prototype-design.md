# Countermovement jump height — web prototype design

Date: 2026-10-13
Status: approved in chat, pending spec review

## Goal

A browser prototype that measures the height of a countermovement jump (CMJ,
hands on hips, two-footed) from video of the jumper, filmed from the front.
Purpose: evaluate whether the parabola-fitting method is accurate and robust
enough before building a native phone app.

Out of scope: native apps, accounts, storage of results, jumps other than CMJ.

## Method

During flight the centre of mass (COM) is in free fall: vertical acceleration
is exactly −g. With hands on hips and straight legs, the hip keypoint moves
rigidly with the COM, and the toes move rigidly with the hip.

We do **not** differentiate keypoint positions (a feasibility simulation showed
the acceleration noise is 1–200× g). Instead we fit curves:

1. Detect the floor line from toe/heel keypoints during quiet stance.
2. The airborne interval is the longest run of frames where the toes are above
   the floor line by more than a noise-scaled threshold.
3. Fit `y = a·t² + b·t + c` to the hip and to the toes over the airborne frames.
4. Takeoff `t_off` and landing `t_on`: roots of the toe parabola at floor
   height (sub-frame precision).
5. Apex `t_apex = −b/(2a)` from the hip parabola.
6. **Height (primary):** `h = g/2 · (t_apex − t_off)²`. It does not use the
   landing, so landing with bent knees does not inflate it.
7. **Height (secondary):** flight time `h = g·(t_on − t_off)²/8`, for comparison
   with commercial devices (contact mats, light bars, My Jump) that use it.

Both formulas depend only on time, so camera distance and zoom do not matter.

Jump height is defined as COM rise after takeoff (the force-plate convention),
not apex minus standing hip height (that overestimates by ~5–10 cm).

### Quality checks (reported with every jump)

| Check | Why |
|---|---|
| Implied g: the pixel scale from the hip curvature, compared against the person's body size in pixels, must give a plausible g | Detects slow-motion/speed-ramped video, wrong timestamps, arm swing |
| Fit residual RMS of hip and toe parabolas | Detects tucked legs, arm swing, bad keypoints |
| Number of airborne frames ≥ 8 | Too few frames → unreliable fit |
| Primary vs secondary height differ by < 15 % (initial value) | Large gap → bent-knee landing or bad takeoff |
| Floor line stable before vs after the jump | Detects a moving camera |
| Frame rate and timestamp regularity | Reports effective fps |

Thresholds are tuned on the test set; initial values are set from the simulation.

The implied-g check needs a pixel scale independent of the fit. Use the
person's standing height in pixels (nose-to-ankle × a fixed ratio) together
with an optional user-entered body height (default 1.75 m). This check is
coarse (±15 %) but catches 2× slow motion easily.

## Architecture

TypeScript + Vite, no backend. Pose estimation: MediaPipe Pose Landmarker
(`@mediapipe/tasks-vision`, WASM + GPU delegate) running in the browser.

```
src/
  pose/       PoseSource: frames → {t, landmarks[]}; camera and file implementations
  analysis/   pure TS, no DOM: floor detection, segmentation, parabola fit, heights, checks
  ui/         preview + skeleton overlay, result card, trajectory plot
tools/
  batch/      Playwright script: runs the app on every test video, writes results table
```

- **PoseSource (camera):** `getUserMedia`, front camera by default, asks for the
  highest available frame rate; timestamps from `requestVideoFrameCallback`
  (`mediaTime` or `captureTime`).
- **PoseSource (file):** uploaded video, processed frame by frame with
  `requestVideoFrameCallback` so every decoded frame is analysed once, using
  its real presentation timestamp (handles variable frame rates).
- **analysis:** input is a time series of landmarks (hip midpoint, left/right
  heel and toe, plus nose/ankles for body size, with visibility scores);
  output is a list of jumps `{t_off, t_on, t_apex, h_primary, h_flight, checks}`.
  Deterministic and unit-testable.
- **UI:** live preview with skeleton; after each jump, a result card and a plot of
  hip/toe y(t) with the fitted parabolas and detected events.

## Testing

1. **Unit tests (Vitest)** on `analysis` with synthetic jumps (the model from
   the spike: realistic CMJ hip curve + noise, various fps), including edge
   cases: no jump, two jumps, a step instead of a jump, arm swing, bent-knee landing.
2. **Batch evaluation:** Playwright + Chromium runs the real app on each test
   video and writes `results.csv` (video, jump index, both heights, checks).
3. **Accuracy reference:** the user's own recordings with hand-counted flight
   frames at 240 fps (and My Jump 2 if available). Target: primary height
   within ±2 cm of the reference on well-filmed 60 fps video.

### Test videos

Stored outside the repo in `../data/` (third-party content, not committed).
The repo holds a manifest `testdata/videos.json` with id, source URL, view,
fps, arm technique (`hips` | `free` | `bar`) and any reference values.

| Video | View | fps | Arms | Notes |
|---|---|---|---|---|
| instagram `DRLgnAQlI8y` | front, handheld | 30 | hips | 6 jumps with reference values (24.7, 25.9, 24.9 / 25.1, 25.3, 27.0; unit unknown); likely speed ramps, moving camera |
| youtube `x-1aKYUhd_k` | front, static | 30 | hips | ideal case |
| youtube `DZV_RlzfSIY` | side, static | 30 | hips | several jumps |
| youtube `0NWWXm8jg6g` | front, static, force plate | 25 | bar | loaded CMJ |
| youtube `ElIb8VBrjLM` | front, static | 30 | free | arm swing |
| youtube `3u1uz8ghdk0` | oblique, contact mat | 30 | hips + free | results maybe on screen |
| youtube `09yR5a4u-6A` | side | 50 | free | |
| youtube `A7GeA3lBpg8` | side, several people | 50 | free | |

Arm-swing (`free`) videos are a reference for the flight-time result and must
trigger the quality checks rather than produce a silently wrong primary height.

## Known limitations

- Phone browsers usually deliver 30 fps, sometimes 60. Motion blur at 30 fps is
  ~4 cm at takeoff. Uploading a slow-motion recording is the higher-accuracy path.
- Hip keypoint is anatomically vague; the method only needs it to be consistent
  during flight.
- Moving cameras (handheld social-media video) break the method; they are
  detected, not corrected.
