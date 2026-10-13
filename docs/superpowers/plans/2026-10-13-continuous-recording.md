# Continuous Recording (Refined Jump Measurement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure every live jump from *all* camera frames, even on phones that can only run the pose model on a fraction of them, by recording the camera continuously and re-analysing the recorded piece around each detected jump.

**Architecture:** Live mode keeps running as today (pose on as many frames as the phone manages) and only *detects* jumps. In parallel, a `RollingRecorder` records the camera stream with `MediaRecorder` in overlapping pieces. When the live tracker reports a jump, a `Refiner` takes the piece that fully contains the jump, decodes it frame by frame in a hidden `<video>`, runs pose on every frame, and runs `findJumps` on that piece alone. The refined jump replaces the live one in the UI. If anything in the refinement fails, the live result is shown, marked as approximate.

**Tech Stack:** existing Vite + TypeScript app, `MediaRecorder`, `requestVideoFrameCallback`, MediaPipe tasks-vision, Vitest, Playwright (Google Chrome, fake camera).

**Spec / context:** `docs/superpowers/specs/2026-10-13-cmj-web-prototype-design.md`, `docs/evaluation/2026-10-13-first-evaluation.md`. Motivation: a real phone (Android 10, Chrome) analysed only ~13 fps live → 7–8 frames in the air → jumps rejected as `few-frames`, and the accepted one over-estimated (session `../data/sessions/2026-10-13T18-20.json`, replay with `npx tsx tools/replay.ts`).

## Global Constraints

- The app never comments on jump technique; only setup instructions (hands on hips, body/feet in view, camera still).
- `src/analysis/` stays DOM-free.
- Every analysed frame uses its own media timestamp from `requestVideoFrameCallback`, never wall-clock time at processing.
- The camera request stays `1280x720` ideal (smaller requests get cropped by some cameras, cutting off the feet).
- The refined result must come from the recorded piece's own timeline (internally consistent timestamps); the live timeline is only used to *find* the piece.
- Never block the live preview: refinement runs one jump at a time, in the background.
- Work goes to the `dev` branch (https://ljungqvist.github.io/boing/dev/); `main` only with the user's explicit OK.

## Design decisions

1. **Rolling pieces.** One `MediaRecorder` can't yield a playable clip from the middle of a recording. So a new recorder starts every `STAGGER = 3 s` and each records `PIECE = 6 s`, giving two overlapping recorders at any time. Any window shorter than `PIECE − STAGGER = 3 s` lies fully inside some piece. A jump window is `[tOff − 1.0 s, tOn + 0.8 s]` ≈ 2.3 s. Keep the last 4 pieces (~24 s of video) and discard older ones.
2. **Time mapping.** Note `performance.now()` (same clock as the camera's `captureTime`) when each recorder fires `onstart`. A piece covers live times `[start, start + duration]`. Start latency is uncertain by tens of ms, so pick pieces with ≥ 0.4 s margin on both sides, and inside the piece search the window ±0.5 s.
3. **Formats.** Prefer `video/webm;codecs=vp8`, then `video/webm`, then `video/mp4` (Safari); pick via `MediaRecorder.isTypeSupported`. Bitrate ~4 Mbps; keep the camera's frame rate. If no type is supported → feature off, live results only.
4. **Decoding.** Reuse the frame-stepping in `src/web/file.ts` (pause in each `requestVideoFrameCallback`, detect, resume), generalised to a `Blob`. WebM from MediaRecorder has no cues/duration, so never seek; always play from the start.
5. **Pose for refinement.** A second `Pose` instance (separate VIDEO-mode clock) with the same model kind as live (`full`, or `lite` on slow phones). Only one refinement at a time; queue further jumps.
6. **Choosing the refined jump.** Run `findJumps` on the decoded piece; take the jump whose takeoff is closest to the live takeoff (after mapping) and within ±0.5 s. If none, or it has a reject flag → show the live result marked approximate.
7. **UI.** After landing, the big overlay shows "Measuring…" (no number); when refined, it shows the number and speaks it. If refinement fails or takes > 15 s, show the live number with "≈". Chips and details show the refined values; details add "Frames analysed: N (of M recorded)".
8. **Diagnostics.** Save session includes per jump: live and refined heights, frames, piece format, refinement time. Debug URL option `?refine=off`.

## File structure

- `src/web/recorder.ts`: `RollingRecorder` (MediaRecorder lifecycle) plus a pure `choosePiece(pieces, window)` function.
- `src/web/recorder.test.ts`: unit tests for `choosePiece` and the stagger schedule logic (pure functions only).
- `src/web/file.ts`: generalise `processFile(file: File, …)` to `processVideo(source: Blob, …)`; keep `processFile` as a thin wrapper (capture-fps metadata only for MP4 files).
- `src/web/refiner.ts`: `Refiner` queue: piece → decode → pose → `findJumps` → pick → result or failure.
- `src/web/main.ts`: wire recorder and refiner into live mode; "Measuring…" state; approximate fallback.
- `e2e/refine.spec.ts`: end-to-end tests with the fake camera.

---

### Task 1: Piece selection (pure, TDD)

**Files:** `src/web/recorder.ts` (pure part), `src/web/recorder.test.ts`

**Produces:** `interface Piece { start: number; end: number; blob: Blob | null }`, `choosePiece(pieces: Piece[], from: number, to: number, margin = 0.4): Piece | null`. It returns the finished piece that contains `[from − margin, to + margin]`, preferring the one where the window is most central.

- [ ] Tests: window inside one piece; window in the overlap of two (picks the more central one); window not covered yet (piece still recording) → null; window older than all kept pieces → null.
- [ ] Implement; `npm test` green; commit.

### Task 2: RollingRecorder

**Files:** `src/web/recorder.ts`

**Produces:** `class RollingRecorder { constructor(stream: MediaStream, opts?: { piece?: number; stagger?: number; keep?: number }); start(): void; stop(): void; pieces(): Piece[]; readonly mimeType: string | null; static supported(): boolean }`. Times in seconds on the `performance.now()` clock.

- [ ] Start a recorder every `stagger` s, stop it after `piece` s, collect chunks (`ondataavailable`) into a `Blob` on stop; drop pieces beyond `keep`.
- [ ] No unit test of MediaRecorder itself (browser-only); covered by Task 5 e2e.
- [ ] Commit.

### Task 3: Frame-by-frame decoding of a Blob

**Files:** `src/web/file.ts`

**Produces:** `processVideo(source: Blob, video: HTMLVideoElement, onFrame: (t: number) => void, onProgress, signal): Promise<{ frameCount: number }>`; `processFile` keeps its current signature and behaviour.

- [ ] Refactor; the existing e2e file test (`e2e/app.spec.ts`, slow-motion file) must still pass unchanged.
- [ ] Use a hidden, separate `<video>` for refinement (never the visible preview).
- [ ] Commit.

### Task 4: Refiner

**Files:** `src/web/refiner.ts`

**Produces:** `class Refiner { constructor(getPose: () => Promise<Pose>, video: HTMLVideoElement); refine(live: Jump, piece: Piece): Promise<{ jump: Jump; frames: number; ms: number } | { error: string }> }`. Jobs are serialised.

- [ ] Decode the piece, pose on every frame (its own `Pose` instance, `resetClock()` per piece), `toSignals` + `findJumps`, pick the jump as in design decision 6.
- [ ] Map times: piece-local time + `piece.start` → live timeline (for matching only).
- [ ] Timeout 15 s → `{ error: "timeout" }`.
- [ ] Commit.

### Task 5: Live-mode integration + UI

**Files:** `src/web/main.ts`, `src/web/style.css`, `index.html` (if needed)

- [ ] Start `RollingRecorder` with the camera stream when live starts (unless `?refine=off` or unsupported); stop it on stop.
- [ ] On each accepted live jump: show "Measuring…" overlay, wait until a piece covers the window (poll up to `PIECE` s), refine, then show/speak the refined height. On failure, show the live height with "≈" and keep it in the chips marked approximate.
- [ ] Rejected live jumps whose rejection is `few-frames` are refined too (that's exactly the slow-phone case); other rejections are not.
- [ ] `window.boing.results` entries get `refined: boolean`, `framesLive`, `framesRefined`.
- [ ] Commit.

### Task 6: End-to-end tests

**Files:** `e2e/refine.spec.ts` (fake camera `../data/e2e/own-two-jumps.y4m`)

- [ ] Normal speed: ≥ 3 jumps, all `refined`, `framesRefined ≥ framesLive`, heights 20–36 cm (the fake camera delivers ~3–9 % slow, which inflates heights a bit; that's a test-rig artefact).
- [ ] Slow phone: `/?delegate=cpu&model=full` + CDP `Emulation.setCPUThrottlingRate` 4–6 → live frames drop. Refined results must still appear with `framesRefined` close to the recorded frame count (≥ 0.8 × fps × air time).
- [ ] `?refine=off` → behaves exactly as before.
- [ ] Check the Playwright **exit code**, not grep output. Commit.

### Task 7: Ship to dev and phone checklist

- [ ] `npm run typecheck && npm test && npm run e2e` all green (exit code 0).
- [ ] Merge into `dev`, push, wait for the Pages run, smoke-test https://ljungqvist.github.io/boing/dev/ with the fake camera.
- [ ] Tell the user what to try on the phone: 4–5 jumps, does "Measuring…" turn into a number within a few seconds, do all jumps get a result, and press Save session afterwards.

## Risks to watch

- MediaRecorder on older Android can drop frames or produce variable frame rates. The refined analysis already uses per-frame timestamps; report the recorded fps in diagnostics.
- Running live pose + refinement pose at once may slow the live rate further. If so, pause live pose while a refinement runs (the preview keeps playing).
- iPhone Safari records `video/mp4` with different timestamp behaviour; not testable here, so flag it to the user.
- Memory: 4 pieces × 6 s × 4 Mbps ≈ 12 MB, fine.

## Implementation notes (2026-10-14)

Deviations from the design above, found while testing with the fake camera:

- **Window and margins.** `[tOff − 1.0, tOn + 0.8]` plus 0.4 s margins is ≈ 3.1–3.2 s, more than
  `PIECE − STAGGER = 3 s` guarantees. Used `[tOff − 0.8, tOn + 0.6]` (`BEFORE`/`AFTER` in
  `refiner.ts`), margin 0.3 s, 0.25 s extra analysed on both sides, takeoff match ±0.5 s.
  Measured live↔piece offsets: mostly within ±25 ms, worst seen 0.21 s.
- **Decoding with WebCodecs, not `<video>` stepping.** Pausing a `<video>` in each frame callback
  skips frames when the page is busy (39 of ~180 frames on a throttled page, 110 of ~145 with the
  CPU delegate): exactly the slow-phone case. WebM pieces are now demuxed (`src/media/webm.ts`)
  and decoded with `VideoDecoder` (`src/web/decode.ts`): every frame, with container timestamps,
  and only the window is posed (earlier frames are just decoded). `<video>` stepping
  (`processVideo`) remains the fallback (MP4/Safari, no WebCodecs).
- **One pose instance, live paused while refining.** A second MediaPipe instance running (or
  starting) next to the live one made Chrome's camera stop delivering frames for good.
  The refiner borrows the live `Pose` (its clock is rebased so MediaPipe timestamps keep
  increasing) and live analysis pauses meanwhile; status shows "Measuring…". Jumps during
  that pause are not detected. Refinement takes ~3 s on a laptop GPU and ~11–13 s on the
  slow-phone rig (60 fps fake camera, so twice the frames of a 30 fps phone).
- **Recorder start.** Starting `MediaRecorder` together with the camera or the model's first
  detections also stalled the camera; it now starts once the model has run for 1 s. A jump
  within ~2 s of "Ready" therefore has no piece yet and is shown as "≈".
- **Piece start time** is taken at `MediaRecorder.start()`, not `onstart` (late on a busy page).
- Per-jump diagnostics are in `window.boing.measurements` and in "Save session" (`jumps`).
