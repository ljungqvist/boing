# Accuracy review: why some jumps read far too high or too low

Date: 2026-10-15. Branch `jump-accuracy-review`. Scope: the native app's live mode (jump seen live,
measured again from the recording), which is where the outliers show up (jumps of 21–25 cm reading 16
or 50 cm). No new recordings; evidence from the existing videos, landmark files and saved sessions.

## Summary

1. **A one-frame mistake is already a big outlier.** The height uses only times, squared:
   `h = g/2·t²`. For a 22 cm jump the takeoff→apex time is 212 ms; one frame at 30 fps (33 ms) more
   or less gives **29.4 or 15.7 cm**. A "16" is one frame of takeoff error; a "50" needs 107 ms
   (three frames), which only gross failures produce (points 2 and 3).
2. **Moving towards a floor-level camera in the air** shifts the hips' highest point late. On the 240 fps
   reference video one jump (16.1 cm hand-measured) reads **28 to 71 cm** depending on model, frame rate
   and blur, and every check passed it. A jump can't land higher than it took off, so takeoff→apex can't
   exceed the flight-time height. That rule separates all 45 such cases from all 269 normal ones in the
   simulation. **Changed on the branch: rejected.**
3. **The lighter pose model creeps.** Live mode re-measures with the **full** model, not heavy as the file
   import does. Full lifts the toe point while the heels rise, so the "flight" starts 40–70 ms early.
   Simulated: a 14.3 cm jump read 24.5–27.7 cm. Heavy has half the spread and no such cases on sharp
   frames. **Changed: heavy for re-measuring; jumps with unsteady points rejected.**
4. **A rejected re-measurement fell back to the live height** ("≈"), measured from fewer frames of the
   same movement. **Changed: only a doubtful recording falls back now, not an unmeasurable movement.**
5. **What remains: a systematic offset of about +4 cm on that reference video.** The toe point leaves
   the floor before the toes do and touches down after them. It depends on feet, footwear and camera,
   and it can't be calibrated from the data we have (on the athlete video it was −2 cm). Also a spread
   of ±1–2 cm (heavy, 30 fps), which is the 30 fps limit.

Simulated native live mode on the 7 hand-marked jumps of the 240 fps video, thinned to 30 fps at all 8
frame phases (56 jumps). Error of the shown height against the hand-marked flight-time height:

| | today (full model) | branch (heavy model, new rejections) |
|---|---|---|
| sharp frames | +7.8 ± 10.0 cm, worst **+42.6** | +3.8 ± 1.1 cm, worst +5.5 |
| motion blur ≈ 1/60 s | +7.3 ± 8.0, worst **+30.8** | +4.9 ± 1.7, worst +7.9 |
| motion blur ≈ 1/30 s | +7.3 ± 6.6, worst **+29.8** | +5.3 ± 2.1, worst +9.8 |

(Branch: 8 of 56 rejected, the drifting jump at every phase. The mean ≈ +4 cm is the offset in point 5.)

A caveat about the "21–25 cm" itself: on the 240 fps session (Galaxy S24+, socks on tiles) the
hand-marked flight times give **14.4–19.3 cm**, while Boing read 19–22. If that offset holds for the live
sessions too, the jumps are lower than Boing says, and a "16" may be nearer the truth than it looks.
Only a reference measurement (contact mat, force plate, or a 240 fps clip marked by hand) can settle this.

## 1. How a live jump is measured (native app)

1. Live frames (front camera by default, full model) → `JumpTracker` → `findJumps` every 0.25 s.
2. A jump that passes (or fails only for few frames) is re-measured from the recording:
   `analyzeClip` decodes every recorded frame from 1.1 s before takeoff to 0.9 s after landing, a fresh
   VIDEO-mode landmarker (until now: **the full model**), then `findJumps` on those frames.
3. `findJumps`: airborne run = toes (mean of both "foot index" points) above a rolling floor by
   max(4σ, 2 % of body height); toe creep trimmed; **takeoff and landing = where a parabola fitted to the
   toes crosses the floor level**; **apex = vertex of a parabola fitted to the hips**.
4. Shown: `hPrimary = g/2·(tApex − tOff)²` (takeoff→apex, comparable to a force plate). Also computed:
   `hFlight = g·(tOn − tOff)²/8`.
5. Rejected (listed as ignored): no free-fall curve, few frames, implausible g, out of view, inconsistent
   (heights more than 2× apart). Only notes: poor-fit, disagree (> 15 %), camera-moved.
6. If the re-measurement failed **or was rejected**, the live measurement is shown with "≈".

## 2. Error propagation

`h = g/2·τ²`, so `dh/h = 2·dτ/τ`.

| | interval τ (22 cm jump) | 1 ms error | one frame at 30 fps (33 ms) | one frame at 60 fps |
|---|---|---|---|---|
| takeoff→apex (`hPrimary`) | 212 ms, from takeoff (toes) and apex (hips) | 0.21 cm | 15.7 / 29.4 cm | 18.7 / 25.6 cm |
| flight time (`hFlight`) | 424 ms (both edges, toes) | 0.10 cm per edge | 18.7 / 25.6 cm (one edge) | 20.3 / 23.8 cm |

- **Takeoff→apex is twice as sensitive to timing as the flight time**: its interval is half as long. Its two
  times come from different body points (toes, hips), so it also picks up anything that moves the hips'
  apex (drift, the trunk tilting, landmark noise). The flight time uses only the feet, but includes the
  landing posture: landing with bent knees lengthens the flight (UABkrMpNunc: 20 vs 26 cm).
- Even at 240 fps the hips' apex is only good to about ±10 ms against the flight midpoint: hips and
  shoulders peak up to 16 ms apart (the trunk tilts in the air). That is ±2 cm of `hPrimary` before any
  takeoff error.

## 3. Findings

### F1 Drift towards or away from a floor-level camera (big outliers, both directions)

A phone on the floor tilted up sees the hips well above its lens. If the person comes closer, the hips
appear higher: to the camera, coming 10 cm closer looks like ≈ 4 cm of extra rise
(sensitivity ≈ (hip height − lens height) / distance ≈ 0.4). A drift during the flight adds a slope, and
the hips' apex moves by drift speed / g: 20 cm over 0.4 s puts it ≈ 20 ms late, +4 cm on a 22 cm jump.
Drifting away moves the apex early and reads low.

Evidence: jump 5 of the 240 fps video. Hip width grew from 143 to 177 px during the flight (≈ 20 % closer)
and the feet landed ≈ 50 px lower in the picture than they took off. Its apex is 37–55 ms after the
flight midpoint (normal: −13…+12 ms). It reads 40.9 cm (heavy, 240 fps) and 28–71 cm in the simulations, against 16.1 hand-measured.
The live session of 2026-10-13 21:40 has a 38.0 cm jump of the same shape (the others ≈ 25).

Physics gives a clean test: at takeoff the body is as stretched as it gets, so the landing can't be
higher, the fall can't be shorter than the rise, and `hPrimary ≤ hFlight` up to noise.

| hPrimary / hFlight | normal jumps | drift jump |
|---|---|---|
| simulation, sharp (269 / 45) | max 1.11 | min 1.32 |
| simulation, blur 1/30 s (96 / 16) | max 1.15 | min 1.35 |
| all accepted real jumps (93: own, YouTube, sessions) | max 1.19 (a 24 fps YouTube clip, itself flagged camera-moved), otherwise ≤ 1.10 | 1.52, 1.23 |

A camera at hip height, pointing straight ahead, should be about 10× less sensitive to this (the hips sit
near the lens height; a geometry estimate, not tested). The feet then become sensitive instead, which the landing edge must handle by measuring
the floor after landing (see R5).

### F2 The live re-measurement uses the full model

`LiveCamera.tsx` loads `full` for live detection and re-used it for `analyzeClip`; file import measures
with `heavy`. Simulation (drift jump excluded, 48 jumps, 30 fps):

| | sharp | blur 1/60 s | blur 1/30 s |
|---|---|---|---|
| full | +4.0 ± 2.1, worst +10.5 | +4.3 ± 2.2, worst +11.2 | +5.2 ± 3.6, worst +13.3 |
| heavy | +3.8 ± 1.1, worst +5.5 | +4.9 ± 1.7, worst +7.9 | +5.3 ± 2.1, worst +9.8 |
| lite | +6.7 ± 3.3, worst +15.1 | | |

The worst cases share one pattern: the toe point rises 2–3 % of body height while the heels come up in
the push-off, the run starts there, and the toe parabola (fitted through those slow frames) crosses the
floor 40–70 ms early. Example: 14.3 cm jump, full model, 30 fps: takeoff 52 ms early, **24.8 cm**, flagged
`poor-fit`, accepted. The hip apex was right (2 ms off).

Why `trimCreep` left it in: the airborne run is found against a *rolling* floor (25th percentile over ±1 s),
the creep test measures from the *median floor before the jump*. The toe point dips in the
countermovement, so the two differ (here 184.9 vs 189.3 px): the creep frames were 11.7 px above the one
(start of the run, threshold 10.2) and 7.3 px above the other (not creep). Measuring the creep from the
same floor (`creepRolling` in `jumps_exp.ts`) cuts the full model's worst case from +10.5 to +8.5 cm
(sharp) and +11.2 to +8.1 (blur 1/60 s), but moves some real jumps by 2–4.5 cm without a truth to
say which way is right. Not changed; a candidate once there are reference jumps.

`poor-fit` (toe or hip residuals > 1.5 % of body height) only fired on bad measurements in the simulation:
all 11 jumps with toe residuals > 1.5 % were 8–15 cm high. In real data it fires only on the drift jump
and on the contact-mat video, whose frame times are wrong (25 fps converted to 30, documented earlier).
It was a note, not a rejection.

### F3 Falling back to the live height after a rejection

`LiveController.refine` showed the live result ("≈") whenever the re-measured jump was rejected. For a
broken recording (wrong time base, `g-implausible`) that is right. For a movement that can't be measured
(drift, out of view), the live frames show the same movement with fewer frames: the outlier comes back
with a "≈". The web app does the same. Also: the jump was still "pending" when its result arrived, so
after an ignored jump "Measuring…" stayed on screen.

### F4 Systematic offset of the toe edges (not fixed)

At 240 fps (heavy), against hand-marked last-foot-off / first-foot-down: takeoff 17–30 ms early,
landing 27–36 ms late. Causes:

- The "foot index" point sits around the ball of the foot. On tiptoe it is ≈ 2–4 cm above the floor
  when the toes leave, and the parabola is extended down to the flat-foot floor level.
- The two feet leave and land 2–50 ms apart (here mostly the left foot first off and last down); the
  mean of both toes widens the flight by about half of that.
- The toes rise faster than the hips right after takeoff (feet pulled up): the toe parabola is "taller"
  than the hips' and its floor crossings lie further out.

Tried: per-foot edges at a fixed height above each foot's floor (3 % of body height: −3 ± 8 ms /
0 ± 9 ms at 240 fps, nearly unbiased), but on the athlete video and the force-plate video it read 5–7 cm
low. On the athlete video the toe points *lag* instead (VIDEO-mode smoothing, documented earlier). So the
offset depends on the person, the footwear and the camera; one sign doesn't fit all. Not changed. Needs
reference jumps in the user's own setup.

Also tried: takeoff = when the legs (hip − toe) are longest (−11 ± 7 ms at 240 fps). On the 240 fps video
it removes most of the offset (heavy at 60 fps: +1.7 ± 0.8 cm), but on every other video it reads 5–25 cm
low (side views, shoes): the leg-length peak depends on the camera angle. A warning against tuning the
edges on this one video.

### F5 Smaller things

- **Landing level**: the landing crossing uses the floor level *before* the jump; after drift or with a
  hip-height camera the floor after landing differs. `floorAfter` is computed but only used for the
  camera-moved note. No change on any recording here (floor camera); matters for R5.
- **Edge times are not bounded by the frames**: a toe-parabola root can lie before the last frame
  where the toes were still on the floor (seen on several jumps). Clamping helped at 240 fps but hurt
  where frame times are wrong, so left out until there is more truth data.
- **Web recordings have jittery frame times** (± 4 ms sd around a regular 33.3 ms grid, up to ± 10 ms).
  Regularising them changed heights by < 1 cm. Native recordings carry sensor timestamps.
- **Upside-down phone**: the app allows reverse portrait (`sensorPortrait`), but whether CameraX writes a
  matching rotation into the recording isn't verified. An upside-down recording would make every
  re-measurement fail. The diagnostics already show the rotation; worth checking once.

### F6 The 16.3 cm jump of the 2026-10-13 22:05 session

The only saved real-world low outlier with landmarks (web app, full model, 30 fps recording; others
24.0–25.5). Re-measured: takeoff→apex 16.3, flight time 20.1, apex 20 ms before the flight midpoint.
Correcting the flight time for the landing posture (legs 6.6 cm shorter at touchdown than at takeoff),
without using the apex at all, gives 16.5. So two partly independent routes agree. The live analysis of
the same jump (18 fps) said 22.0 / 22.9. Most likely a lower jump or a deeper landing, not a pure error; at 30 fps it
can't be told apart from a one-frame takeoff error.

## 4. Changes on the branch (prototypes, committed, not merged or pushed)

- `src/analysis/jumps.ts`: `inconsistent` also when `hPrimary > 1.2 × hFlight` (apex too late for the
  landing). Test with a synthetic drift. On all recordings only the two known outliers change.
- `mobile/src/logic/measure.ts`, `src/web/refiner.ts`: `poor-fit` rejects ("unsteady body points").
  Live jumps flagged `inconsistent` or `poor-fit` at the live frame rate are still re-measured.
- `mobile/src/logic/live.ts`, `src/web/main.ts`: a re-measurement rejected for the movement (`inconsistent`,
  `out-of-view`, `not-parabola`, `poor-fit`) is listed as ignored instead of showing the live height.
  A doubtful recording (`g-implausible`, `few-frames`) still falls back. Not pending when the result arrives.
- `mobile/src/ui/LiveCamera.tsx`: re-measure with the heavy model (downloaded in the background; full
  until it's there), timeout 60 s, the model is logged in the diagnostics. Type-checks, but not run on a
  phone. On the Galaxy Tab A8 heavy took ≈ 0.24 s per frame, i.e. ≈ 20 s per jump at 30 fps; a flagship
  should take a few seconds.

Unit tests (91) and e2e tests (9) pass.

## 5. Recommendations, not done

Ranked by expected effect on the outliers:

- **R1 Test the branch on the phone** with the usual setup: does heavy keep up, do the rejections show
  up as "ignored", how often.
- **R2 A setup hint, if wanted**: camera about hip height and level instead of on the floor, 2.5–3 m away.
  By geometry it cuts the drift sensitivity (F1) about tenfold (untested; needs R5 first). It's a setup
  instruction, not technique.
- **R3 A reference session in your own setup**: 10 jumps filmed in 240 fps slow motion from the side of the
  feet (or on a contact mat) while the app measures live. That fixes the offset (F4) for this setup and
  shows whether the offset is the same at 30 fps live.
- **R4 60 fps recording** where the camera offers it: less blur and twice the frames. In the simulation
  heavy at 60 fps was no better than at 30 on sharp frames, but blur is what makes the full model fail.
- **R5 Landing level from the floor after landing** (with a test), needed for any camera not on the floor.
- **R6 Takeoff edge from a hinge fit** ("slow while on the floor, then free flight"): in the simulation it
  cut the full model's worst case from +13 to +9 cm (blur) and lite's from +15 to +9 cm. But at the
  ≈ 20 fps of the old web sessions it failed badly once (31.9 → 9.2 cm). Promising for the lighter
  models at ≥ 30 fps, not ready (`tools/review/jumps_exp.ts`, `edges: "knee"`).
- **R7 Whole-body centre of mass for the apex** (de Leva segment weights): smoother parabola (residual
  1–2 px instead of 2–4 at 240 fps), but no better in the simulation. Not worth it alone.

Not recommended for now: switching the shown height to the flight time. It is half as sensitive to timing
and was a little tighter in the simulation (heavy, 30 fps: ± 0.9–1.6 vs ± 1.1–2.1 cm), but it adds the
landing posture (bent-knee landings read 5–6 cm higher) and, on this video, a larger offset (+5.4–5.9 cm).

## 6. Tools (`tools/review/`)

- `simulate_native.py`: the native re-measurement offline. A fresh VIDEO-mode landmarker per jump window,
  frames thinned to 30/60/120 fps at every phase, Android-style subsampling, optional motion blur (mean of
  N source frames). Outputs in `../boing-data/review/sim_020914*`.
- `simeval.ts` (current code against the hand-marked truth), `simvariants.ts` / `jumps_exp.ts` (option sets
  of an experimental copy of `findJumps`; with no options it reproduces `findJumps` exactly, checked by
  `check_exp.ts`), `rules.ts` / `falsereject.ts` (rejection rules on simulation and real
  data), `dump.ts` (per-frame dump of one jump), `apex240*.ts`, `feet240.ts` (240 fps landmark studies).
