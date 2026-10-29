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
