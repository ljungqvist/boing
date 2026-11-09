# Public jump demonstrations: takeoff to apex

Eight jumps from three public demonstration videos were reviewed on 2026-11-09:

- Runeasi: https://vimeo.com/1047409121 (30 fps, three oblique/front jumps).
- NeuroForce1: https://vimeo.com/659715854 (24 fps, three side-view jumps).
- DANU: https://www.danusports.com/resources/activities/ (30 fps, one front and one side jump, separated by an edit at frame 106).

## Method and limits

The analysis used Boing's mobile `measureVideo` file-analysis code at commit
85b5f688265061d40c4600fda46ec56d690ff6a9. MediaPipe heavy VIDEO poses were extracted
on CPU with Android-like decoder subsampling (540×960 or 540×750). This was an
offline run, not an on-device UI test. DANU's views also used separate fresh trackers.

Takeoff was bracketed by eye on enlarged original-resolution foot crops. Apex was
selected visually and refined with quadratic fits to independently template-tracked
clothing/hand features near the pelvis, without using MediaPipe landmarks. Height
was calculated as `490.5 × (apexSeconds − takeoffSeconds)²` centimetres. Landing time
was not used for the manual height.

Published playback is assumed real time; original capture rate and speed editing
cannot be independently verified. Visible pelvis features are a proxy for whole-body
centre of mass. Annotation intervals are broad (roughly ±7–15 cm), not statistical
confidence intervals, and exclude additional unquantified speed and anatomical error.
These estimates are not calibrated ground truth or evidence of centimetre accuracy.

## Results

Values below are manual point estimate → Boing raw takeoff-to-apex height, in cm:

- DANU front: 37.7 → 33.2; side: 37.0 → 36.7.
- NeuroForce1 side: 31.5 → 27.1; 35.4 → 28.9; 30.2 → 29.9.
- Runeasi oblique/front: 23.4 → 24.9; 25.8 → 26.8; 23.7 → 25.6.

All eight jumps were accepted. Every raw estimate falls within its conservative
manual annotation interval. The first two NeuroForce1 takeoffs were estimated
32–36 ms later than the manual bracket midpoint, explaining much of their lower
central height estimates. This is a small sample of three people, not a general
comparison of front-view and side-view accuracy.

Boing's raw `hRise` differs from its displayed `hPrimary = min(hRise, hFlight)`.
For NeuroForce1, displayed values were 24.7, 28.7 and 26.6 cm. Keep these metrics
separate when evaluating takeoff-to-apex accuracy; the study did not change them.

## Storage and reproduction

Videos, poses, frame annotations, pixel tracks, uncertainty ranges and results stay
on gwb, outside this public repository. Training/reuse permission is unconfirmed.

- Sources and study: `~/boing-data/public-demos/2026-11-08/` and its `review/` directory.
- Library source: `~/boing-data/library/sources/public-demos-2026-11-09.json`.
- Entries use `reference.metric: "takeoff-to-apex"`, not flight-time `truth.heightCm`.
- Rebuild: `python3 -I ~/boing/tools/library/build.py --data ~/boing-data`.
- Re-evaluate from `~/boing`: `node --import tsx ~/boing-data/public-demos/2026-11-08/review/run_app.ts`.
- Recompute annotations: `python3 ~/boing-data/public-demos/2026-11-08/review/build_review.py`.

The rebuilt library preserved all 94 previous IDs and added eight entries (102 total).
File integrity passed. The older accuracy regression failed with a 15.7667 cm worst
error in its group labelled front/native 60 fps (2026-10-15), identically against the
saved pre-change 94-entry index. That failure remains for separate investigation;
thresholds were not relaxed. Baseline output is saved as `review/baseline-test.log`.
