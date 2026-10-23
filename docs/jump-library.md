# Jump library

Reference jumps with a truth, for evaluating ideas and for accuracy tests. The data lives **only on
the developer's machine** in `~/code/boing-data/library/` (override with `BOING_LIBRARY`); it is never
committed: it holds videos of people. This repository has only the code that builds and reads it.

## Layout

```
library/
  jumps.json                 one entry per jump (below)
  README.md                  local notes
  clips/<date>/…             video clips (cut without re-encoding, metadata stripped)
  clips/reference/…          whole videos with a reference value from another device
  pose/<date>/…              pose files (PoseVideo JSON: width, height, fps, frames[{t, lm}], model)
```

Built from `boing-data` (`own/`, `uploads/`, `review/`, `landmarks/`, `youtube/`) by
`tools/library/build.py` (idempotent; `--force` cuts again). The sources are never changed.

## Clips

`tools/library/cut.py` cuts by stream copy from the keyframe at or before the wanted start, so every
original frame is kept bit for bit (checked by decoding frames of both files), drops all metadata
(GPS location) and writes the slow-motion capture rate back (`com.android.capture.fps`). Each clip
has a `<clip>.cut.json` with `frameOffset` (original frame index of clip frame 0) and the source.
240 fps clips: real time = frame index / 240; ≈ 3 s before takeoff to 2 s after landing.

## jumps.json entries

- `id`, `person` (nickname; `people` maps them), `date`, `session`
- `setup`: view, camera placement, floor, footwear, arms, light; `devices`
- `clips[]`: `role` (`side-240`, `app-front`, `video`), `file`, `captureFps`, `frameOffset`, `clipStart`
- `pose[]`: `role` (`front-heavy-app`: the app's logged re-measurement, app frame clock;
  `front-heavy-full-rate`: every frame of a deleted video, real seconds; `side-<fps>-<blur>…`: side view
  through the native simulation), `file`, `clock`
- `truth`: `method`, `precision`, `takeoffT`/`landingT` (seconds on the clip's or pose's clock, see
  `clock`), `takeoffFrame`/`landingFrame` (clip frames, when from a clip), `flightMs`, `heightCm`
  (flight-time height g·t²/8)
- `reference` (instead of a truth): a device's value (contact mat, force plate, My Jump), not frame-exact
- `clock.appMinusSide`: app frame clock = side clip real time + this (2026-10-19)
- `app`: what the app logged and showed at the time
- `tags`: `clean`, `drift-towards-camera`, `toe-plateau`, `small-hop`, `lost-to-rotation`,
  `rejected-poor-fit`, `reference-only`, …
- `videoDeleted`: the original was deleted; the entry is pose-only

`derived[]` lists the native simulations (`review/sim_*`) of videos that no longer exist.

## Contents (2026-10-23, 60 jumps)

| | jumps | truth | data |
|---|---|---|---|
| 2026-10-19 side-view reference | 12 | sock toes at 240 fps, ±2 frames | side 240 fps clips, app front clips, logged poses |
| 2026-10-14 240 fps (deleted) | 7 | hand-marked at 240 fps | full-rate pose; simulations |
| 2026-10-13 120 / 60 fps (deleted) | 4 | hand-marked | full-rate pose; simulation (120 fps) |
| 2026-10-15 native table / floor (deleted) | 14 (13 with truth) | hand-marked at 60 fps | the app's re-measured pose |
| 2026-10-21 native front 60 fps (Galaxy S24+) | 8 | hand-marked at 60 fps from the app's clips | app clips (cut), logged poses |
| 2026-10-23 native front 60 fps (S24+), five people, day and evening light | 10 | hand-marked at 60 fps from the app's clips | app clips (cut), MediaPipe heavy on every frame |
| reference videos (WhatsApp, contact mat, force plate) | 5 | device values | whole video + pose |

## Use

- `npx tsx tools/library/evaluate.ts ['{"name": {<jumps_exp options>}}'] [--detail]`: every variant on
  every set, split by view × frame rate × blur.
- `tools/library/library.test.ts`: files present and today's accuracy within bounds; skipped without
  the library.

## Adding jumps

Uploads from the app (other people, with consent) are added as data, not code: triage writes
`library/sources/<session>.json` (`build.py` `from_marks()` documents the fields: upload folder, id
prefix, person `u-<recording ID>`, `phone`, setup, devices, `marks` per clip, optional tags) and
rebuilds. Their jumps carry `phone`; `tools/erase.py <recording ID>` removes them, their clips and
poses when consent is withdrawn (run by gwb's poller for every erase request).

Other people: their OK to keep the footage, a nickname only. Best truth: a second phone at floor level,
side-on, 240 fps, socks or shoes with a colour that stands out from the floor (`tools/review/side_*`).
Add a section to `build.py`, rebuild, check the edges by eye (`tools/library/edge_sheets.py`).

## Triage of uploads

Done on gwb by the `boing-uploads` agent skill (`tools/gwb/README.md`): unattended, one session at a
time, by the rules there (current edge cases with video first, clean jumps only as a baseline). Library
jumps from uploads are `library/sources/<session>.json`; the 2026-10-23 session predates that and is a
`build.py` section.

The sources of already-built sections can be gone (videos deleted after cutting); `build.py` then keeps
their entries from the last `jumps.json`, so `jumps.json` and the clips in the library are the record.
