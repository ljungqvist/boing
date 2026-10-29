# Measuring speed: where the ≈ 20 s per jump go, and what to do about them

Date: 2026-10-29. Branch `claude/measurement-performance-sxblfn`. The question: on a Galaxy S24+ the
height of a live jump takes close to 20 s after landing. Make it faster without giving up accuracy;
should the app keep MediaPipe or get a pose model of its own?

No phone or jump library was at hand for this work. The analysis below is from the code; the changes
keep the results the same (same frames, same model, same fresh tracker per jump, pixel for pixel the
same images) and add a timing breakdown to the diagnostics, so the next session on the phone shows
where the time actually goes.

## What happens between landing and the height (before this change)

| step | where | rough cost |
|---|---|---|
| the live tracker reports the jump once the landing is 0.8 s old | `JumpTracker` (settle) | ≈ 0.8 s |
| the recording continues until 0.9 s after landing (`AFTER` + `PAD`), then stops (file finalised) | `LiveController.push`, `rotate` | ≈ 0.1–0.5 s more |
| **the next recording is started, and measuring waits for that** | `rotate`: `await startClip()` before `measure` | CameraX: ≈ 0.3–1 s |
| `readVideoInfo` walks every sample of the clip (up to a minute of video) | `analyzeVideo` | ≈ 0.1 s |
| **the heavy model is loaded and its GPU programs built, for every jump** | `VideoLandmarker.create` in `analyzeVideo` | ≈ 1–3 s (not measured) |
| decode from the key frame before the window (≤ 1 s of video, hardware decoder) | `decodeFrames` | small |
| **per frame: YUV → RGB in Kotlin, one `ByteBuffer.get` per byte**, then a separate rotation pass | `toBitmapScaled`, `rotated` | ≈ 10–30 ms × ≈ 150 frames |
| per frame: heavy pose model, **one after the other with decoding** (no overlap) | `detect` | ≈ 30–100 ms × ≈ 150 frames |
| meanwhile the live analysis keeps running the full model on **every camera frame (60 fps)** on the same GPU/CPU, and the camera keeps recording | `HybridPoseDetector` | slows the measurement down |

The window is 1.1 s before takeoff to 0.9 s after landing: ≈ 2.5 s, i.e. ≈ 150 frames at 60 fps
(the S24+ records at 60). 20 s means ≈ 120 ms per frame all in, several times what the heavy model
alone should need on that phone, so most of the time is likely around the model, not in it.

## Changed (results unchanged)

1. **One jump at a time** (user's decision, 2026-10-29). Once a jump is seen, the live analysis stops:
   no skeleton, status "Measuring · not ready", no pose on the camera frames, and no new recording.
   The jump's clip ends 0.9 s after landing as before and is measured right away. After the height is
   out, the next recording starts, the live analysis resumes from scratch, and the status turns green.
   A jump made while measuring isn't seen at all (before, it was queued and read out afterwards, which
   made it unclear which jump a height belonged to). The camera preview stays on: the phone draws it
   without the app's involvement. `LiveController` (`busy`, `paused` event), unit test.
2. **The heavy model is loaded ahead of time** (`boingPose.prepare`, from `LiveCamera` once it's
   downloaded). Each jump still gets a fresh landmarker, as before (no tracking state from the last jump);
   the next one loads in the background after each measurement. `releasePrepared` when the camera stops.
3. **YUV → RGB reads bulk copies of the planes and rotates in the same pass** (`toUprightBitmap`):
   the same subsampling and formula, each pixel written straight to its rotated place (checked against
   convert-then-rotate for all four rotations).
4. **Decoding runs on its own thread, up to 3 frames ahead** (`FrameReader`), so decoding and converting
   overlap with the pose inference. Same frames, same order.
5. While a jump is measured the live pose model doesn't run at all (`PoseDetector.minInterval` =
   Infinity), leaving the GPU and CPU to the measurement.
6. The clip's rotation and duration come from the metadata instead of a pass over all samples.

**Diagnostics:** every re-measured jump now logs and shows where the time went:

```
t 12.3 s · live 24.1 cm (11 fr) → 23.0 cm (27 fr, 60 fps, 5200 ms, offset 0.02 s) · took 6.8 s: wait 1.5, model 0.0, pose 4.1 (GPU), decode 1.8 alongside, 192 frames
```

- `took`: from the moment the jump was seen live until its height was ready.
- `wait`: until measuring could start (end of the recording, earlier jumps).
- `model`: loading the model (≈ 0 when it was prepared in time).
- `pose`: the pose model on all frames; `(GPU)`/`(CPU)`: where it ran.
- `decode`: decoding and converting, alongside `pose` (it only costs time when it's larger than `pose`).
- iOS reports the same fields (decoding there is not overlapped).

Not yet run on a phone: the APK is built by CI from this branch.

## Next, once the timing is known

- **`pose` is most of it** → try the heavy model on the CPU (XNNPACK) for re-measuring: on a flagship
  the big cores may beat a GPU shared with the camera, preview, encoder and live analysis. Numerics
  differ only at float16-vs-float32 level; check heights on the library before switching.
- **`wait` is large** → the 0.9 s after landing (`AFTER` + `PAD`) and the clip stop are the floor of it.
  Shorter only together with the window change below.
- **The window.** ≈ 2.5 s are analysed for ≈ 0.45 s of flight. The 0.3 s `PAD` on both sides is only there
  because the live → recording clock mapping is approximate; the logged `offset` shows how far off it is.
  If it's always < 0.1 s, `PAD` 0.1 would save ≈ 16 % of the frames. This changes which standing frames
  the floor level and noise estimate see, so it needs a run over the jump library first (gwb), not a
  guess: `npx tsx tools/library/window_eval.ts` cuts every library jump to shorter windows (and a
  variant at half the frame rate more than 0.3 s before takeoff) and prints the error per set. Shorter
  windows save up to ≈ 30 % of the frames (0.7 / 0.5 s: 102 instead of 150 at 60 fps).

## Own pose model? Not now

- The pose model is not where the accuracy is lost in a way a new model would fix: the steady offset is
  the foot point (ball of the foot, not the toe tip) at takeoff and landing. A whole-body model with real
  toe points (RTMW-x, COCO-WholeBody) helped only on full-resolution 60 fps video, did worse at 30 fps,
  and its phone-sized versions (RTMW-l/m) lost most of the gain (`docs/accuracy-ideas.md`, 2026-10-21).
- Training one ourselves needs thousands of labelled frames with exact foot contact, plus months of
  work, and it would still run once per frame like MediaPipe.
- MediaPipe's heavy model is likely not the main cost today (see the table above). The timing line
  will say.

What *is* worth building for this use case is not a pose model but **contact detection from pixels**
(accuracy idea 2): the pose only locates the feet, and takeoff/landing come from how the patch just
above the floor around them changes. It was the most promising accuracy result so far (front 30 fps:
+0.5 ± 2.5 cm vs +1.9 ± 2.1 cm, every jump measured, insensitive to blur), and per frame it is a few
hundred pixel differences instead of a neural network. With the edges from pixels, the heavy pose would
only be needed for the hips' apex and to find the feet, so it may not have to run on every frame of the
window (and higher capture rates become affordable). That is the path to "more accurate *and* faster",
but it needs the library run over the new sessions (other people, shoes, floors) to fix its threshold
first, as decided on 2026-10-21.

## Results from the phone (2026-10-29)

Analysed on gwb on 2026-10-30. The earlier jumps of the evening were not kept (recordings were off);
four jumps of the new build were sent afterwards, one per upload (front camera, 60 fps, GPU).

### New build: ≈ 5.6 s from jump seen to height (was ≈ 15 s of analysis alone)

| per jump (4 jumps) | median | range |
|---|---|---|
| `totalMs` (jump seen → height) | 5.62 s | 5.58–5.75 s |
| `waitMs` (jump seen → measuring starts) | 0.10 s | 0.09–0.12 s |
| `openMs` (model) | 0.0 s | prepared every time |
| `poseMs` | 4.9 s | 4.80–5.01 s for 144–147 frames: **33–34 ms per frame** |
| `decodeMs` (alongside) | 3.8 s | 3.55–3.96 s for 173–198 decoded frames (from the key frame), < `poseMs` |

The old build needed ≈ 100 ms per frame all in, the new one 38 ms (pose 33 ms of it). The pose model is
now ≈ 87 % of the time; waiting, loading and decoding are nearly gone. On top of the 5.6 s come the
0.8 s after landing before the live tracker reports the jump.

**Heights unchanged.** Takeoff and landing marked by eye on the clips (foot crops, ±1 frame), height from
the flight time, against the app: −0.9, +1.2, −0.6, −1.1 cm (the 4th −2.8 cm if the landing is one frame
earlier). Mean −0.4 cm, the same as the app-clip library set (−0.4 ± 0.9 cm). fps 60.0, 24–35 frames in
the air, g 8.3–10.5, offsets −0.14 … −0.22 s, all 4 accepted (flags `disagree` 2×, `toe-plateau` +
`camera-moved` 1×). One jump at a time held: one jump per upload, each measured within 0.1 s of being
seen.

### Old build: where the time went (all uploads 2026-10-19 … 10-27)

34 re-measured jumps in 8 sessions (10 at 30 fps, 24 at 60 fps). The old build logs only `ms`
(analysis: open, decode, pose), not the wait before it.

| | median | range |
|---|---|---|
| analysis `ms`, 60 fps (≈ 145 frames) | 15.0 s | 12.6–21.3 s (one 41.9 s, below) |
| ms per analysed frame, all in | 111 ms | 87–217 ms |

That is ≈ 100 ms per frame all in at 60 fps. Add the recording stop and the next clip's start, and you
get the ≈ 20 s heard on the phone. The build 36 timing line will split it into model / pose / decode.

**One live "jump" with a 26 m height** (≈ 4.6 s in the air: a false alarm, not a jump) was re-measured
over 395 frames. It took 41.9 s and ended in `no-match`. With one jump at a time, that blocks the app
for the whole 41.9 s.

### Old build: the takeoff offset is a steady bias, not scatter

`offset` (re-measured − live takeoff) over 31 matched jumps: **never within ±0.1 s**; 17 within
±0.2 s, 29 within ±0.3 s.

| | offsets (s) |
|---|---|
| 30 fps (one setup) | −0.31 … −0.19, nearly all −0.23 … −0.26 |
| 60 fps | −0.28 … −0.11, median −0.15; two outliers −0.47 and +0.16 (both rejected jumps) |

The re-measured takeoff is always 0.1–0.3 s *earlier* than the live one, and the size of the bias
depends on the setup (frame rate or phone). So the live → recording clock mapping (or the live takeoff
time) runs late by a near-constant amount. Because of that, today's window really holds ≈ 0.85–0.95 s
before the takeoff and ≈ 1.05–1.15 s after the landing, not 1.1 / 0.9 s. `PAD` 0.3 s can't simply
shrink to 0.1 s: the bias would eat it. First correct the bias (find where it comes from, or shift the
window by it). Then shrink `PAD` to cover only the scatter around it (≈ ±0.1 s at 60 fps).

### Old build: "couldn't measure"

15 of 34 re-measurements failed (44 %; 2 of 10 at 30 fps, 13 of 24 at 60 fps):

| result | count | flags |
|---|---|---|
| `rejected` | 12 | `poor-fit` 12, `disagree` 9, `camera-moved` 7, `inconsistent` 3, `out-of-view` 1, `not-parabola` 1 |
| `no-match` (no jump within 0.5 s of the live one) | 3 | one is the 26 m false alarm above |

Likely causes:
- `camera-moved` shows up in 7 of the 13 failures at 60 fps. Either the phone moved (handheld or
  bumped), or the check fires on something else at 60 fps. Those clips are worth a look.
- `poor-fit` + `disagree` without `camera-moved` (4) means the pose loses the feet in the air. These
  rejections are safe: in the library, the same flags mark jumps read at half their true height.
- The `no-match` cases are live false alarms, which the re-measurement rightly refused.

### Window evaluation on the jump library

`npx tsx tools/library/window_eval.ts` (≈ 5 min on gwb) cuts each library jump to a window around its
own (true) takeoff. The table compares today's window with the shortest one: accepted / total, error
mean ± sd, worst (cm).

| set | 1.1 / 0.9 s (today) | 0.7 / 0.5 s |
|---|---|---|
| front, native 30 fps (10-19) | 10/10 +1.7 ± 2.1, +5.4 | 10/10 +1.7 ± 2.1, +5.4 |
| front, native 60 fps (10-21) | 7/8 +2.2 ± 1.3, +3.4 | 7/8 +2.2 ± 1.2, +3.4 |
| front, 60 fps, pose on every frame of the app's clip (10-23) | **7/10** −0.4 ± 0.9, −1.6 | **6/10** −0.4 ± 1.0, −1.6 |
| front, native 60 fps (10-15, plus the 6 upload jumps of 10-24/27) | 12/19 +1.3 ± 2.2, +6.1 | 12/19 +1.2 ± 2.4, +6.1 |
| front, full rate 60–240 fps | 10/11 +3.0 ± 1.6, +5.3 | 10/11 +2.8 ± 1.9, +5.3 |
| front, simulated 30–240 fps (7 sets) | means +2.8 … +4.9 | each within 0.2 cm, same counts |
| side, simulated 30/60 fps (6 sets) | 423/432 accepted | 421/432, means within 0.3 cm, worst ≤ today |
| RTMPose sets (3) | | within 0.1 cm, same counts |

0.9 / 0.7 s and 0.8 / 0.6 s fall between the two (every mean within 0.2 cm of today). Halving the frame
rate before −0.3 s moves the app-clip set to −0.9 ± 1.2 cm (worst −2.4) at 1.1 / 0.9 s. At 0.9 / 0.7 s
it gives the same result as the 0.7 / 0.5 s column.

- **Heights don't shift** with a shorter window: means within 0.3 cm, worst errors the same or better.
- **One app-clip jump is lost with *every* shorter window.** Today it is accepted at 13.1 cm (truth
  13.6, flag `camera-moved`); at 0.9 / 0.7 s it is already rejected. With less standing time before the
  takeoff, the floor level is off when the camera moves. It's a safe failure (a rejection, not a wrong
  height), but one more "couldn't measure".
- The evaluation centres the window on the true takeoff. The app centres it on the live takeoff, which
  is 0.1–0.3 s late (above). So in the app, the window before the takeoff is shorter than these names
  say.

### Next step

1. **CPU vs GPU for the pose model** (it is ≈ 87 % of the time now, 33 ms per frame on the GPU): a menu
   switch "Re-measure jumps on: GPU / CPU" (branch `claude/remeasure-cpu-option`) to compare on the
   phone, same jumps' `poseMs` per frame.
2. **Don't re-measure live "jumps" that can't be jumps** (over 1 s in the air, i.e. heights of
   metres). Each costs tens of seconds of a blocked app and ends in a `no-match`. Done on the same
   branch.
3. **Find the takeoff bias** (live vs recording clock) before touching the window. After that, `PAD`
   0.1 s (0.9 / 0.7 s, ≈ 16 % fewer frames) is the step the library supports. The price is jumps like
   the `camera-moved` one above. It saves fewer frames than a faster pose per frame could, so it comes
   after step 1.
