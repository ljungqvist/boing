# Accuracy ideas: to-do list and results

A living list of ideas for making Boing's heights more accurate: what each one is, how it was or will be
checked, how it fared, and what to do about it. Update the status and numbers when an idea is tested.

The app is primed for a phone **on the floor** (leaning against a wall or in a stand), because jumps are
measured in the field, not in a lab. Ideas that need a different setup are judged against that.

**Where we stand (heavy model, height shown vs flight-time truth):**

| | frame rate | error | worst |
|---|---|---|---|
| native, 2026-10-15 table + floor (hand-marked) | 60 fps | +0.9 ± 1.5 cm | +3.5 |
| native, 2026-10-19 (240 fps side-view truth) | 30 fps | +2.0 ± 2.1 cm | +5.4 |
| simulation of the 2026-10-14 video, sharp / blur 1/30 s | 30 fps | +3.8 ± 1.1 / +4.9 ± 1.8 cm | +5.5 / +7.2 |

Most of the steady offset is the foot: MediaPipe's "foot index" point sits around the ball of the
foot, so the toe-point "flight" starts before the toes leave the floor and ends after they touch down.
60 fps helps mainly against motion blur, not by the extra frames (sharp frames: no gain in simulation).

Status: **shipped** · **tested, no gain** · **to test** · **idea**.

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

## To test, ranked

### 1. A pose model that finds the toe tip — to test

Whole-body models (e.g. RTMPose with COCO-WholeBody points) mark the big toe, little toe and heel
separately. With the real toe tip, takeoff/landing timing should move close to the truth, which is
where most of the offset comes from.
Check: run the candidate model on the 240 fps clips and the native clips with truth; compare edge
errors and heights with MediaPipe. Then: can it run on the phone, and fast enough to re-measure?
Decide: adopt if it removes most of the offset without new outliers.

### 2. Takeoff/landing from the pixels around the feet — to test

Use the pose only to find the foot, then decide from the image crop when it leaves and touches the
floor (frame differencing, the gap between foot and floor/reflection). The 2026-10-19 truth was made
this way from red socks (`tools/review/side_redtoe.py`); it has to work without them.
Check: same truth sets; edge error per frame. Decide: adopt if it's robust across floors, shoes, light.

### 3. Rolling shutter — to test (cheap)

Phone sensors read the image line by line over ≈ 10–30 ms. If readout runs top to bottom in portrait,
the feet (low in the picture) are captured later than the hips: a constant shift of takeoff→apex,
worth ±1–2 cm.
Check: readout direction and time for the front cameras in use (Camera2 `SENSOR_ROLLING_SHUTTER_SKEW`,
sensor orientation vs portrait); compare edge/apex offsets by image row. Decide: correct per row if real.

### 4. Take takeoff/landing from the centre of mass (hinge fit) — to test

In the air the centre of mass follows an exact free-fall parabola whatever the arms and legs do (feet
pulled up included); the hips don't. On the floor the floor pushes, so it isn't in free fall. Takeoff =
where the centre-of-mass curve joins the free-fall parabola, landing = where it leaves it. Optionally
fix the curvature to g (needs the pixel scale) and fit only the apex time and height.
Estimating it: segmental method, segment masses and centre positions from de Leva (1996), on the 33
MediaPipe points (`tools/review/com.ts` exists; the hinge exists for the toes as `edges: "knee"`).
Risk: at 30 fps the switch has to be found within a 33 ms gap; noise blurs it.
Check: all truth sets, especially the two toe-plateau jumps of 2026-10-19. Decide: adopt if it beats
the toe edges at 30 fps.

### 5. Film the jumper from the side — to test

With the phone on the floor, moving towards or away from it changes the hips' apparent height (the
32.4 cm jump of 2026-10-19 was 23.5). Countermovement jumps drift forwards/backwards; from the side that
becomes harmless left-right motion. The foot in profile also shows the heel rise and the toes leaving.
Risks: the two hips overlap (left/right swaps, forearm over the hip with hands on hips), trunk lean moves
the hip point, the far foot hides behind the near one.
Check: the 2026-10-19 side videos (240 fps, floor level) thinned to 30 and 60 fps at several phases
through the native re-measurement, against the sock truth; compare with the front view of the same 12
jumps. Decide: if clearly better, a setup hint ("stand side-on to the phone"; a setup instruction, not
technique) and side-view tuning.

### 6. Higher capture rates where available — idea

Some phones record 120/240 fps. Using that for the re-measurement recording would cut timing error a
lot. Check what the app's camera library offers per device and the re-measurement time per jump.

### 7. Shorter exposure — idea

Blur widens the spread and the worst cases (simulation: ± 1.1 sharp → ± 1.8 cm at 1/30 s). Cap the
exposure time if the camera allows it; log the exposure in the diagnostics; otherwise a "bright light"
setup hint.

### 8. Correct the flight time for the landing posture — idea

Bent knees at landing lengthen the flight. Compare leg length (hip–ankle) at takeoff and landing and
correct; on the 16.3 cm jump of 2026-10-13 this gave 16.5 from the flight time alone.

### 9. Combine the estimates — idea

Weight the flight time, takeoff→apex and the centre-of-mass curve by their known errors instead of
taking one or the smaller.

### 10. More truth data — to do

The side-view setup (240 fps phone at floor level, red socks) gives cheap, precise truth. Sessions in
other shoes, floors, light, phones and with other people would show which ideas really work and keep us
from tuning to one setup. Planned: a local jump library (below).

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
