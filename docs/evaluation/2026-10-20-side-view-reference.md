# Side-view reference session (2026-10-19, live mode vs 240 fps side video)

Date: 2026-10-20. The native app measured live (Galaxy S22 `SM-S901B`, front camera, 30 fps, heavy model
for re-measuring, phone on the floor tilted back 10–21°) while a second phone filmed the feet from the
side in slow motion (240 fps, two videos `own/20261019_233859.mp4` and `_234100.mp4`, 79 s + 125 s).
Debug upload: `uploads/2026-10-19_233836` (session.json, 10 clips). Socks on a wooden floor.

## Truth

Jumps found on the side videos with a coarse pose pass (full model, every 4th frame), then takeoff and
landing at 240 fps from the lowest red pixel of the sock toes (first frame ≥ 6 px above the floor line,
first frame back on it). Checked by eye on foot crops: within 1–2 frames (4–8 ms); flight-time height
good to ≈ ±0.5 cm. Clocks matched by the sequence of jumps: app time = side time + 520.22 s (first video)
and + 640.86 s (second), every jump within ±0.05 s. All 12 jumps on the videos are in the app's log;
every other live candidate (18) was walking, handling the phones, or a fragment of a real jump.

| side | app t (s) | truth (flight time) | app shown | app re-measured hP / hF | live | what happened |
|---|---|---|---|---|---|---|
| 1 #1 | 525.6 | 19.6 | 21.7 | 21.7 / 20.0 | 26.4 | |
| 1 #2 | 541.3 | 23.5 | — | 34.0 / 29.2 | 24.2 | rejected "unsteady body points" (toe residual 2.45 %) |
| 1 #3 | 558.3 | 23.5 | 27.0 (live) | — | 27.0 | clip replaced 0.13 s before takeoff → not re-measured |
| 1 #4 | 567.5 | 16.1 | 16.2 | 16.2 / 16.2 | 17.1 | |
| 1 #5 | 585.1 | 7.4 | 8.5 | 8.5 / 9.2 | 21.1 | a small hop; live was wrong, re-measure right |
| 2 #1 | 646.1 | 21.3 | 20.0 | 20.0 / 21.9 | 21.0 | |
| 2 #2 | 664.2 | 23.5 | **32.4** | 32.4 / 27.5 | 32.7 | moved towards the phone in the air (hips +15 % wider) |
| 2 #3 | 682.5 | 22.6 | 23.9 | 23.9 / 25.1 | 27.3 | |
| 2 #4 | 700.1 | 8.2 | 11.1 | 11.1 / 11.5 | 11.1 | a small hop |
| 2 #5 | 717.1 | 20.9 | — | — | 26.4 | clip replaced 0.31 s before takeoff → live only, few frames → ignored |
| 2 #6 | 721.8 | 21.7 | — | 27.2 / 27.5 | 36.4 | rejected "unsteady body points" (toe residual ≈ 1.5 %) |
| 2 #7 | 742.3 | 20.9 | 25.2 | 25.2 / 26.7 | 33.9 | |

Re-measured and accepted, without the drift jump (7): **+1.5 ± 1.7 cm** against the flight-time truth
(worst +4.3). The same sign and size as the earlier offset (+2 to +4 cm, accuracy review F4).

## Findings

1. **Clip rotation lost two jumps (fixed on this branch).** A clip without jumps was replaced after 15 s
   of quiet. After each jump the next clip starts ≈ 1 s after landing; the user jumped again every
   ≈ 18 s (after hearing the height), so the replacement fell into the next countermovement. 4 of the 10
   re-measured jumps started 0.75–1.5 s into a fresh clip, and 2 jumps fell 0.1–0.3 s after one and
   weren't re-measured at all. Now a clip is replaced after 15 s only when nobody is in the picture,
   otherwise after 60 s.
2. **The 32.4 cm jump was 23.5 cm.** The user moved ≈ 20 cm towards the floor-level front camera during
   the flight (side view; in the front view hip width grew 113 → 131 px, +15 %, shoulders +23 %). That
   is the drift of accuracy review F1: the hips' apex comes late. hP/hF = 1.18, just under the 1.2
   rejection. In the other 9 re-measured jumps hip width changed by −3.5 … +5.8 % and hP/hF ≤ 1.08 in the accepted ones.
   Candidates (not done): reject when hip width changes > 10 % between standing before and after
   (the 240 fps drift jump of 2026-10-14 had +24 %), or lower `MAX_RISE_OVER_FLIGHT` to 1.15. Both need a
   check on the older sessions first.
   **Follow-up (changed): the shown height is capped at the flight-time height.** The size change
   didn't separate drift from normal jumps on the older data (`size_change.ts`): standing before vs after,
   normal jumps reach ±15–18 % (people shift their stance on landing); in the air (first vs last 70 ms)
   it is noise at 30 fps (this jump: −7 %). Physics gives a cleaner rule: a jump can't land higher
   than it took off, so takeoff→apex above the flight-time height means a late apex, and the flight
   time is then the better estimate. `hPrimary = min(takeoff→apex, flight-time height)`; the uncapped
   value is kept as `hRise` (consistency flags, diagnostics). Error of the shown height on every set
   with a truth (`cap_eval.ts`; accepted/all, cm):

   | | today | capped |
   |---|---|---|
   | sim 240→30 fps heavy, sharp | 48/56 +3.8 ± 1.1, worst +5.5 | same |
   | sim 240→30 heavy, blur 1/60 s | 48/56 +4.9 ± 1.7, worst +7.9 | +4.8 ± 1.5, worst +7.2 |
   | sim 240→30 heavy, blur 1/30 s | 48/56 +5.3 ± 2.1, worst +9.8 | +4.9 ± 1.8, worst +7.2 |
   | sim 240→60 heavy / 240→30 full / 120→30 heavy | unchanged | unchanged |
   | native 2026-10-15 table + floor (hand-marked) | 9/13 +1.2 ± 1.8, worst +4.1 | +0.9 ± 1.5, worst +3.5 |
   | native 2026-10-19 (this session) | 9/10 +2.7 ± 2.9, worst +8.9 | +2.0 ± 2.1, worst +5.4 |

   Never worse, nothing more rejected. The 32.4 cm jump reads 27.5 (truth 23.5). Rejecting above 1.15
   instead was no better and drops jumps.
3. **The two "unsteady body points" rejections were right to reject.** Their re-measured heights were
   +10.5 and +5.5 cm off. In the front view the toes plateau for ≈ 6 frames mid-flight (feet pulled up),
   so the whole-flight toe parabola is too wide and its floor crossings too far out (flight +51 ms).
   The jumps were clean; the measurement wasn't. A takeoff/landing edge that uses only the frames next to
   the floor (R6 hinge fit) would address this; not attempted.
   **Follow-up: no edge variant does better** (`edge_eval.ts`, shown height incl. the cap, accepted/all,
   cm). Fitting the toe parabola only below 70/80/90 % of its peak (new `toeFitBelow`, skips the
   plateau), local edges, the hinge fit, per-foot edges and clamped edges each help one set and hurt
   another, and none brings the 541 s jump back:

   | | today | below 0.8 | below 0.9 | clamp | per foot (last) |
   |---|---|---|---|---|---|
   | sim 240→30 heavy, sharp | +3.8 ± 1.1 | +3.6 ± 1.2 | +3.4 ± 1.1 | +3.5 ± 1.1 | −0.6 ± 1.2 |
   | sim 240→30 heavy, blur 1/30 s | +4.9 ± 1.8 | +5.1 ± 2.0 | +4.8 ± 1.8 | +4.7 ± 1.8 | +0.2 ± 1.1 |
   | native 10-15 table + floor | +0.9 ± 1.5 | +0.8 ± 1.4 | +1.2 ± 1.9 | +1.0 ± 2.2 | −3.7 ± 1.5 |
   | native 10-19 (this session) | +2.0 ± 2.1 | +2.2 ± 2.3 | +1.7 ± 1.9 (8/10) | +1.7 ± 2.0 (8/10) | −3.1 ± 1.9 |

   Per-foot edges again remove the offset on the 240 fps video and overshoot on the real sessions
   (as in the accuracy review). Not changed.

4. **The 8.5 and 11.1 cm readings were real**: two small hops (7.4 and 8.2 cm). The live tracker said
   21.1 for the first; the re-measurement was right.
5. **Live candidates are mostly noise.** 20 of 30 were never re-measured; 18 of those weren't jumps
   (walking in and out, fragments next to a real jump with g ≈ 0.05 and "heights" up to 21 m). Since
   2026-10-15 every one of them spoke "Couldn't determine the height". Fixed separately (branch
   `quiet-discard`): only a rejected re-measurement is announced.

## Tools (`tools/review/side_*`)

`side_coarse.py` (coarse pose), `side_find.py` (airborne runs), `side_redtoe.py` (240 fps edges from the
sock toes → `review/side_20261019/edges_redtoe.json`), `side_eval.ts` (logged poses through `findJumps`
against the truth), `side_drift.py` / `side_scale.py` (drift in the side view, body size in the front
view), `side_toes.py` (per-frame toe/hip track of a logged jump), `size_change.ts` (apparent size
change across every jump at hand), `cap_eval.ts` (capping/rejection variants on every truth set), `edge_eval.ts` (experimental finder
option sets on every truth set). Paths point at `../boing-data`.
