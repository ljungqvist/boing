# Accuracy ideas: to-do list and results

A living list of ideas for making Boing's heights more accurate: what each one is, how it was or will be
checked, how it fared, and what to do about it. Update the status and numbers when an idea is tested.

The app is primed for a phone **on the floor** (leaning against a wall or in a stand), because jumps are
measured in the field, not in a lab. Ideas that need a different setup are judged against that.

**Where we stand (heavy model, height shown vs flight-time truth):**

| | frame rate | error | worst |
|---|---|---|---|
| native, 2026-10-15 table + floor (hand-marked) | 60 fps | +0.9 ± 1.5 cm | +3.5 |
| native, 2026-10-19 (240 fps side-view truth) | 30 fps | +1.7 ± 2.1 cm (10/10) | +5.4 |
| native, 2026-10-21 (Galaxy S24+, hand-marked at 60 fps) | 60 fps | +2.2 ± 1.3 cm (7/8) | +3.4 |
| simulation of the 2026-10-14 video, sharp / blur 1/30 s | 30 fps | +3.8 ± 1.1 / +4.9 ± 1.8 cm | +5.5 / +7.2 |

Most of the steady offset is the foot: MediaPipe's "foot index" point sits around the ball of the
foot, so the toe-point "flight" starts before the toes leave the floor and ends after they touch down.
60 fps helps mainly against motion blur, not by the extra frames (sharp frames: no gain in simulation).

Status: **shipped** · **tested, no gain** · **to test** · **idea**.

View policy (user, 2026-10-21): support both front and side view; if one turns out clearly better,
encourage it with a setup hint. So far the difference is small (idea 5), so both stay.

## Done

| idea | status | result | where |
|---|---|---|---|
| Re-measure live jumps with the heavy model, reject unsteady points / late apex | shipped (2026-10-15) | worst case at 30 fps +42.6 → +5.5 cm (simulation) | `evaluation/2026-10-15-accuracy-review.md` |
| Don't replace the recording right before a jump | shipped (2026-10-20) | 2 of 12 jumps were lost on 2026-10-19; unit test | `evaluation/2026-10-20-side-view-reference.md` |
| Cap the shown height at the flight-time height (`hPrimary = min(hRise, hFlight)`) | shipped (2026-10-20) | never worse on any truth set; 2026-10-19 worst +8.9 → +5.4, table/floor +1.2 ± 1.8 → +0.9 ± 1.5 | same, `tools/review/cap_eval.ts` |
| Edge variants: toe fit below 70–90 % of the peak, local edges, hinge on the toes, per-foot edges, clamped edges | tested, no gain | each helps one set and hurts another; per-foot overshoots on real sessions (−3 to −4 cm) | same, `tools/review/edge_eval.ts` |
| Detect drift from the apparent body size (hip/shoulder width) | tested, no gain | normal jumps change ±15–18 % standing before vs after; in the air it's noise at 30 fps | same, `tools/review/size_change.ts` |
| Reject when takeoff→apex > 1.15 × flight time | tested, no gain | no better than the cap, drops jumps | `tools/review/cap_eval.ts` |
| Centre of mass for the apex only (de Leva segments) | tested, no gain | smoother parabola at 240 fps, heights not better: the error is at the edges | review R7, `tools/review/com.ts` |
| Leg-length peak as takeoff | tested, no gain | good on the 240 fps video, 5–25 cm low on side views and in shoes | accuracy review F4 |
| Switch the shown height to the flight time | tested, no gain | tighter but adds the landing posture (bent knees +5–6 cm) | accuracy review |

### 2026-10-21: the 60 fps front session and the toe plateau (shipped)

8 jumps with the app at 60 fps (Galaxy S24+ front camera, 1080×1920), no side reference; takeoff and
landing hand-marked from the app's own clips (`tools/library/front_sheets.py`, ±1 frame = 17 ms;
library entries `2026-10-21-f1…f8`). The app: 6 accepted, +2.6 ± 0.9 cm, worst +3.4; landing read a
steady 25–39 ms late (the toe-point offset). Android reported exposure 0 (only frame rates come through).

The 2 rejected jumps ("unsteady body points") had the **feet pulled up hard** in the air: the toe track
plateaus (toe residual 2.9–3.1 % of body height vs 0.5–0.9 % normally) while the hips stay clean
(0.5–0.6 %). The toe parabola then put the takeoff late and the apex early (takeoff→apex 13.5–15.6 cm
for 21–25 cm jumps). Same pattern as the two plateau jumps of 2026-10-19. Tried on these four:

| | 2026-10-21 f5 / f6 (21.3 / 24.8) | 2026-10-19 a2 / b6 (23.5 / 21.7) |
|---|---|---|
| today | 15.6 ✗ / 13.5 ✗ | 29.2 ✗ / 27.2 |
| centre of mass as apex | 20.1 ✗ / 17.3 ✗ | |
| centre-of-mass hinge | 7.4 ✗ / 7.5 ✗ | |
| edges along the hips (`hipLeg`) | 21.0 / 19.8 | 23.1 / 26.8 |

**Shipped:** when only the toes fit poorly (toe residual > 1.5 %, hips ≤ 1.5 %), `findJumps` takes the
edges along the hips (first/last frames with the toes clearly in the air, moved back to the floor along
the hip parabola) and accepts the jump if its two heights agree within 1.3×; flag `toe-plateau` (a note).
Every front set gains or holds (`tools/library/hip_rule_eval.ts`):

| | before | after |
|---|---|---|
| native 30 fps (2026-10-19) | 9/10 +1.9 ± 2.1, worst +5.4 | **10/10** +1.7 ± 2.1, worst +5.4 |
| native 60 fps (2026-10-21) | 6/8 +2.6 ± 0.9, worst +3.4 | **7/8** +2.2 ± 1.3, worst +3.4 |
| native 60 fps (2026-10-15) | 9/13 +0.9 ± 1.5, worst +3.5 | **11/13** +0.9 ± 1.8, worst +3.6 |
| simulations (front) | | unchanged |
| side, sim 30 fps sharp / 60 fps blur 1/60 | 85/96 +3.0, worst +7.9 / 39/48 +2.5, worst +6.6 | 96/96 +3.2, worst +8.7 / 46/48 +2.6, worst +7.8 |

Side view: more jumps measured, those read a little high (+0.2 cm mean, worst +1 cm). Accepted for the
front-first app. The centre of mass helps the tucked jumps only partly (logged poses lack arms; the hips
already fly a parabola), so it isn't the fix here.

### 2026-10-21: centre of mass with other pose models, at 60 fps (no gain from the centre of mass)

Pose of the same jumps from five models (`tools/library/pose_sources.py`, `vitpose_source.py`;
library files `pose/…/<id>_front_<model>.json`, `side/<id>/<model>.json`): the app's MediaPipe heavy
(540×960, 13 logged points), MediaPipe heavy at full resolution (33 points), RTMPose-x body with feet
(Halpe26), RTMW whole body (x, l, m; COCO-WholeBody 133 points incl. big/small toe and heel), ViTPose++
huge (COCO 17, no feet: ankles used as feet). Sets: 2026-10-21 front 60 fps (8, hand-marked),
2026-10-19 side thinned to 60 fps (12 × 4 phases, sock-toe truth), 2026-10-19 front 30 fps (10).
Centre of mass (de Leva; hidden side mirrored from the visible one, `tools/review/com.ts`) as apex,
hinge (both edges / takeoff / landing), and a new **joint fit** (parabola and edges together, the ground
as tangent lines; `comGround: "joint"`; curved ground `"jointq"`). `tools/library/com_eval.ts`.

Today's method (no centre of mass) on each model's pose:

| | app's MediaPipe | MP full-res | RTMPose-halpe | **RTMW-x** | RTMW-l | RTMW-m | ViTPose (ankles) |
|---|---|---|---|---|---|---|---|
| front 60 fps | +2.2 ± 1.3, w +3.4 | +1.8 ± 1.1 | +1.8 ± 0.9 (6/8) | **+1.5 ± 0.9, w +2.5** | +1.9 ± 0.7 | +2.6 ± 0.9 | +8.3 ± 2.4 |
| side 60 fps | +2.0 ± 2.2, w +6.5 | +2.8 ± 2.1 | +4.2 ± 1.2 | **+0.5 ± 1.4, w +3.8** | +1.6 ± 1.5 | +1.4 ± 2.4 | +14.1 ± 3.9 |
| front 30 fps (720p) | +1.7 ± 2.1, w +5.4 | | | +2.1 ± 3.5, w +9.3 | +3.7 ± 3.9 | +3.3 ± 3.9 | |

- **The centre of mass doesn't help at 60 fps with any model**: as the apex it is no better or worse;
  hinges on both edges or the takeoff are worse (outliers up to +16–20 cm). Physics: the floor's push
  fades smoothly at takeoff, so the centre of mass has no sharp kink to find there.
- **Joint fit, landing only** is better everywhere it was tried (app's pose: front +2.2 → +1.0 ± 1.1,
  side +2.0 → +1.0 ± 1.9; RTMW-x: front −0.1 ± 1.0, side −0.0 ± 1.2), **but** it depends strongly on the
  ground window (0.1 / 0.15 / 0.2 s: no change / −1 cm / −3 cm and many rejections), the physically
  right curved ground model is unstable, and a plain **landing 20 ms earlier** does about as well with
  the app's pose (front 60 fps +1.5 ± 1.1, side +1.2 ± 1.8, front 30 fps +0.3 ± 2.3, every set better). So
  it mainly corrects the toe point's late landing (25–39 ms), a calibration — not shipped yet.
- **The model matters more than the centre of mass**: RTMW-x is the best at 60 fps on 1080p (its foot
  points are real toes), but worse than MediaPipe at 30 fps on 720p (per image, no tracking; small feet),
  and the smaller RTMW-l/m (the ones a phone could run) lose most of the gain. Not for the app now.

### Constant offset correction — decided: not yet, wait for more data (2026-10-21)

The shown height is takeoff→apex; the flight time only caps it. The landing correction above worked
only through that cap (it made the corrected flight time the shown height), so it doesn't fit the design.
The matching lever is the takeoff (the toe point leaves the floor 10–45 ms early). Takeoff 10 ms later
(`tools/library/takeoff_shift_eval.ts`): front 30 fps +1.7 → +0.1 ± 2.0, front 60 fps (2026-10-21)
+2.2 → +0.1 ± 1.3, (2026-10-15) +0.9 → −1.0 ± 1.8, full rate +3.0 → +1.2, side 60 fps +2.0 → +0.2. It
removes the mean offset only (the spread stays), and the right value differs by session (≈ 2 cm).
**User's decision: no "magic" correction yet.** Re-check with jumps from other people and in shoes;
ship a correction only if one value fits them all.

## To test, ranked

### 1. A pose model that finds the toe tip — tested, no gain (2026-10-21)

RTMPose-x "body with feet" (Halpe26: big toe, small toe, heel; rtmlib + onnxruntime in its own venv,
`tools/library/rtm_pose.py`), written in MediaPipe's layout with the big toe as the foot point, so
`findJumps` runs unchanged. Run on the app's front frames and on every 240 fps frame of the side
windows (per image, so thinning to 30/60 fps afterwards is exact). Sharp frames only.

| | MediaPipe heavy (today) | RTMPose-x, big toe |
|---|---|---|
| front, app 30 fps (10 jumps) | +1.9 ± 2.1, worst +5.4 (9/10) | +4.0 ± 2.5, worst +7.2 (7/10) |
| side 30 fps (96) | +3.0 ± 1.9, worst +7.9 | +4.5 ± 1.6, worst +8.1 |
| side 60 fps (48) | +1.9 ± 2.3, worst +6.5 | +4.3 ± 1.2, worst +7.1 |

Worse everywhere: no temporal smoothing (per image), the toe points jitter on small feet (front 720p:
"unsteady points" rejections), and the big-toe tip doesn't remove the edge offset. Also no on-device
version. Not pursued.

### 2. Takeoff/landing from the pixels around the feet — tested, promising, not proven (2026-10-21)

`tools/library/pixel_edges.py` (+ `pixel_summary.py`): the pose only locates the feet; a patch just
above the floor around them is compared with the same patch standing before takeoff (takeoff) and
standing after landing (landing), mean absolute grey difference. Edge = where it crosses θ × its
in-air level (linear between frames). No colour assumptions. Only the 2026-10-19 jumps still have
video: the app's front clips (30 fps, real) and the side clips (thinned like the side simulation).

| | θ 0.5 | θ 0.6 | θ 0.7 | pose today |
|---|---|---|---|---|
| front, app 30 fps (10 jumps, independent truth) | +3.7 ± 3.5 | **+0.5 ± 2.5, worst +3.6** (10/10) | −2.2 ± 2.2 | +1.9 ± 2.1, worst +5.4 (9/10) |
| side 30 fps, sharp / blur 1/30 s (96 each) | +5.7 ± 1.4 | +3.4 ± 1.4 | **+1.3 ± 1.5 / +1.2 ± 1.5** | +3.0 ± 1.9 / +4.3 ± 3.4 |
| side 60 fps, sharp / blur 1/30 s (48 each) | +5.6 ± 1.3 | +3.4 ± 1.4 | +1.6 ± 1.3 / +1.4 ± 1.4 | +1.9 ± 2.3 / +4.4 ± 3.8 |

- Measures every jump, including the toe-plateau and drift ones; insensitive to blur and frame rate.
- **Caveats:** θ was chosen on these same jumps, and the best θ differs by view (0.6 front, 0.7 side).
  The side truth also comes from pixels of the *same* video (sock toes), so the side numbers are
  optimistic; the front clips (other camera) are the honest test. On the front the two recordings
  differ by ≈ 5 cm (first −3, second +2 to +3.5: phone tilt 10° vs 21°?), i.e. it depends on the
  setup geometry.
- To ship it would need native pixel code in the app's re-measurement (Kotlin), and truth from other
  setups (shoes, floors, light, people) to fix θ. **Next step: more truth data (idea 10), then decide.**

### 3. Rolling shutter — tested, no gain (2026-10-21)

Phone sensors read the image line by line over ≈ 10–30 ms. Checked by geometry: camera sensors are
mounted with their long side along the phone (`SENSOR_ORIENTATION` 90/270), so in **portrait** video the
readout sweeps *across* the picture (left ↔ right), not top to bottom. An upright person's feet and hips
lie in about the same columns and are captured at the same moment. Side view: hips and toes are at most
≈ 10 % of the width apart → ≤ 2 ms of skew, < 0.5 cm on takeoff→apex, nothing on the flight time.
It would matter only in landscape, which the app doesn't use. Not pursued. (If the app ever allows
landscape: correct per image column with Camera2 `SENSOR_ROLLING_SHUTTER_SKEW`.)

### 4. Take takeoff/landing from the centre of mass (hinge fit) — tested: needs 240 fps at full resolution (2026-10-21)

In the air the centre of mass follows an exact free-fall parabola whatever the arms and legs do; the
hips don't. Edge = where the centre-of-mass curve joins (leaves) the free-fall parabola fitted to the
inner flight frames; the ground side is a tangent line (same position and speed), or a tangent with its
own curvature. Centre of mass: de Leva segments (`tools/review/com.ts`; points the app doesn't log fall
back to the nose and the trunk). Experimental option `edges: "comHinge"` (`comEdges`, `comGround`,
`comWindow`) in `tools/review/jumps_exp.ts`; `tools/library/evaluate.ts` on the library.

Physics caveat: at takeoff the floor's push fades to zero smoothly, so position and speed are continuous
and only the acceleration changes; landing is an impact (sharper).

| front view | today | hinge (both edges) | hinge, takeoff only |
|---|---|---|---|
| full-rate pose, 1080p, one tracker for the whole video (240/120/60 fps, 11) | +3.0 ± 1.6, worst +5.3 | **+0.4 ± 1.3, worst +2.4** | **+0.2 ± 1.1, worst −1.9** |
| sim 240 fps at 540×960, fresh tracker per jump | +4.0 ± 1.1 | +4.9 ± 2.4 | +4.6 ± 2.1 |
| sim 240→120 fps | +4.3 ± 1.3 | +4.6 ± 1.9 | +4.6 ± 1.8 |
| sim 240→60 fps | +4.1 ± 1.4 | +5.8 ± 2.7 | +5.4 ± 2.1 |
| sim 240→30 fps / native 30 fps | +3.8 ± 1.1 / +2.0 ± 2.1 | +10.7 ± 5.9 / +5.6 ± 7.4 | |
| native 60 fps (2026-10-15) | +0.9 ± 1.5 | +3.1 ± 4.5 | |

On the full-resolution 240 fps pose the hinge removes the offset (2026-10-14: takeoff −27 → −5 ± 10 ms
against the hand-marked truth). With the app's resolution (≤ 1280 px decode) and a fresh tracker per
jump it gains nothing even at 240 fps, and it is very sensitive to the ground window (0.1 / 0.15 /
0.25 s: +1.5 / +0.4 / −2.1 cm on the same frames). The own-curvature ground model fails everywhere.
**Not shipped.** Revisit together with idea 6 (high capture rate) and full-resolution decoding.
Also tested: the centre of mass as the apex only (`apex: "com"`): no better (as R7).

### 5. Film the jumper from the side — tested, no clear gain (2026-10-21)

The 2026-10-19 side clips (240 fps, phone at floor level, side-on) through the native re-measurement
(`tools/library/side_sims.py`: heavy, 540×960, fresh tracker per jump, thinned to 30/60 fps at every
phase, sharp and with 1/60 and 1/30 s blur), against the sock-toe truth of the same 12 jumps
(`tools/library/evaluate.ts`, per jump: `per_jump.ts`):

| | side, sharp | side, blur 1/60 s | side, blur 1/30 s | front, same jumps (app, real) |
|---|---|---|---|---|
| 30 fps | +3.0 ± 1.9, worst +7.9 (85/96) | +3.7 ± 2.7 | +4.3 ± 3.4, worst +12.6 | +1.9 ± 2.1, worst +5.4 (9/10) |
| 60 fps | +1.9 ± 2.3, worst +6.5 (43/48) | +2.5 ± 2.1 | +4.4 ± 3.8 | |

- **First finding: from the side nothing was measured at all** (0 of 96): the far foot hides behind the
  near one, its visibility drops below 0.5 in the air, and the toe signal needed both toes. Fixed:
  `toSignals` averages the visible one(s) of each pair (**shipped**, default `anyOfPair`; front sets equal
  or a little better, e.g. sim 240→30 fps +3.8 → +3.6).
- Per jump, the side view handles the hard cases (the two toe-plateau jumps are measured, +4.2 / +2.9;
  the drift jump +3.1 vs +4.0 from the front) but reads higher on normal jumps (e.g. +4.1 vs 0.0,
  +5.3 vs +4.3), and suffers more from blur.
- The centre-of-mass hinge does nothing from the side (the far-side points needed for it are hidden).
- Caveats: one person, socks, 12 jumps; the side phone was a different phone (no tilt, 1080p, 240 fps
  exposure), so this compares setups as much as views.

Not worth a "stand side-on" setup hint: no gain on normal jumps, and the drift case it would fix is
mostly covered by the flight-time cap. The app now works side-on, though.

Also seen on the way: **clamping the edges** to the frames around them (`clampEdges`) is clearly better
at high frame rates (sim 240 fps +4.0 → +2.2, full-rate pose +3.0 → +1.6, 120 fps +4.3 → +2.8, side
60 fps +1.9 → +1.6, worst 6.5 → 4.3) but worse on the native 60 fps set (worst +3.5 → +6.4) and drops
a jump at 30 fps. Candidate for ≥ 120 fps recordings, not for today's 30/60 fps.

### 6. Higher capture rates where available — prepared (2026-10-21)

The app already asks for the highest rate the camera's normal sessions offer, up to 240 fps
(`bestFps`): 30 fps on the Galaxy S22 front camera, 60 on the user's phone. 120/240 fps needs Android's
constrained high-speed sessions, which VisionCamera's normal sessions don't use. The library results
say what it would bring: at 240 fps the centre-of-mass hinge and clamped edges remove most of the
offset (ideas 4 and 5), but only with full-resolution decoding. Done tonight: the diagnostics now log
the session's and the camera's maximum frame rate with every re-measured jump.

### 7. Shorter exposure — prepared (2026-10-21)

VisionCamera 5 can lock exposure time/ISO only on iOS. Done tonight: every re-measured jump logs the
camera's exposure time, ISO and exposure mode where the phone reports them (`camera` in the log,
shown as "exposure 1/120 s, ISO 640, camera 30 fps (max 60)"; on Android exposure may read 0). Not
verified on a phone. The next session tells how much blur there is; until then a "bright light" setup
hint is the lever.

### 8. Correct the flight time for the landing posture — tested, no gain (2026-10-21)

Bent knees at landing lengthen the flight. Correction: the hips' drop between takeoff and landing
(leg length hip − toe at the two edges, px → m by the body scale) splits the flight into rise and a
longer fall (`final: "flightCorr"` in `jumps_exp.ts`; worked on the 16.3 cm jump of 2026-10-13).
On the library it is worse almost everywhere: native 30 fps +2.0 ± 2.1 → +2.7 ± 2.7, sims 240→30
+3.8 ± 1.1 → +4.6 ± 1.2, blur 1/30 +4.9 → +6.0; only native 60 fps improves a little (+0.9 → +0.5).
The flight time alone (`final: "flight"`) is worse still (+2.7 / +5.4). Not shipped; the cap at the
flight-time height (shipped 2026-10-20) keeps the useful part.

### 9. Combine the estimates — tested, no gain (2026-10-21)

Blends of takeoff→apex (`hRise`) and the flight-time height against today's smaller of the two
(`tools/library/combine_eval.ts`, front sets): the mean (+2.6 / +4.5 cm on native 30 / sim 30 fps),
min(rise, mean), 0.7 rise + 0.3 flight capped, rise alone: none beats `min(hRise, hFlight)` on any set.
Both estimates share the same toe-edge bias, so averaging them can't remove it. A bias correction
would, but the offset differs by session (+0.9 to +4 cm), so it can't be calibrated from our data.

### 10. More truth data — to do (most important next step)

The side-view setup (240 fps phone at floor level, side-on, socks or shoes that stand out from the
floor) gives cheap, precise truth. The jump library (`docs/jump-library.md`) now holds 42 jumps (37 with
a truth, 1 person). The open questions that only more data can settle: the pixel edges' threshold
across setups (idea 2), side vs front with other people and shoes (idea 5), and the per-session offset.
Reference clips with device values agree with the usual offset: WhatsApp clip (My Jump 22.25 cm):
flight time 23.6, shown 20.9; force-plate clip (46.1 cm, uncertain): 43.7.

## Jump library (planned, local only)

Reference jumps for evaluating ideas and for tests, in `~/code/boing-data/library/`, never in the
public repository (the repo holds only the code that reads it and this description).

- Clips cut **without re-encoding** (stream copy from the keyframe before the jump), so every 240 fps
  frame is kept; the capture rate is stored in the list (cutting may drop the slow-motion metadata).
  ≈ 30–40 MB per jump instead of the whole recording.
- `jumps.json`, one entry per jump: person (nickname), date, phones, view, floor, footwear, light; the
  clips (side 240 fps, the app's front clip and logged pose when there is one) and the clock mapping;
  the truth (takeoff/landing frame and time, flight time, height, method and precision, e.g. sock pixels
  checked by eye, ±1–2 frames); tags (`clean`, `drift`, `toe-plateau`, `small-hop`, …); what the app
  said at the time.
- An evaluation script runs any method over the library; a test that runs only when the library is
  present (CI stays green without it).
- Other people: same format, a folder per person, with their OK to keep the footage, nickname only.
