# CMJ Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app (laptop and phone) that measures CMJ height live from the camera, or from an uploaded video, using the existing `src/analysis` module.

**Architecture:** Vite + vanilla TypeScript. MediaPipe Pose Landmarker (tasks-vision, WASM + GPU) produces landmarks per video frame with the frame's own timestamp. A `JumpTracker` buffers landmarks and runs `findJumps` on a rolling window, emitting each jump once. The UI shows the camera with a skeleton overlay, results and a plot of the last jump.

**Tech Stack:** Vite, TypeScript, `@mediapipe/tasks-vision`, Vitest, Playwright (Google Chrome channel, fake camera) for an end-to-end test.

**Spec:** `docs/superpowers/specs/2026-10-13-cmj-web-prototype-design.md`, evaluation: `docs/evaluation/2026-10-13-first-evaluation.md`

## Global Constraints

- `src/analysis/` stays free of DOM dependencies; it is shared with the evaluation tools.
- Every analysed frame uses its real timestamp (`requestVideoFrameCallback` metadata), never the wall clock at processing time.
- Height shown first: takeoff→apex (`hPrimary`); flight-time height (`hFlight`) shown second.
- Camera at any angle; the implied-g check uses the widened bounds (4–20 m/s²).
- Slow-motion uploads: time scale from `com.android.capture.fps`, applied only when the shortest frame gaps are > 1.5/capture fps (same rule as `tools/extract_pose.py`).
- Live mode uses the `full` model; file mode uses `heavy`.
- Phones need HTTPS: the dev server runs with a self-signed certificate (`--host`).

---

### Task 1: JumpTracker (TDD)

**Files:** `src/analysis/tracker.ts`, `src/analysis/tracker.test.ts`

**Produces:** `class JumpTracker { constructor(opts?: { windowSeconds?: number; settleSeconds?: number; stature?: number }); push(frame: PoseFrame, size: { width: number; height: number }): Jump[] /* newly finished jumps */; reset(): void }`

- Keeps the last `windowSeconds` (default 8 s) of frames; every push analyses the window (`toSignals` + `findJumps`) at most every 0.25 s of video time.
- A jump is emitted once its landing is `settleSeconds` (default 0.8 s) in the past, de-duplicated by takeoff time (±0.15 s).
- Tests: synthetic jumps rendered as landmark frames, pushed frame by frame → exactly one emission per jump, with the right height; no emission while standing.

### Task 2: MP4 capture-fps reader (TDD)

**Files:** `src/media/mp4meta.ts`, `src/media/mp4meta.test.ts`

**Produces:** `captureFps(buf: ArrayBuffer): number | null`, `slowMotionTimeScale(captureFps: number | null, frameTimes: number[]): number | undefined`

- Tests: hand-built `moov/meta(hdlr, keys, ilst)` bytes with float `com.android.capture.fps` → 120; missing → null; time-scale rule for slow motion vs variable-frame-rate gaps.

### Task 3: Pose source + web app

**Files:** `index.html`, `src/web/main.ts`, `src/web/pose.ts`, `src/web/camera.ts`, `src/web/file.ts`, `src/web/draw.ts`, `src/web/style.css`, `vite.config.ts`

- `pose.ts`: create landmarker (model URL by mode, GPU delegate with CPU fallback), `detect(video, tMs) → Landmark[] | null`.
- `camera.ts`: `getUserMedia` (facingMode user/environment, ask for 60 fps, 720p), frame loop via `requestVideoFrameCallback`, timestamp = `captureTime ?? mediaTime`, measure effective fps.
- `file.ts`: play the file step by step (pause in each frame callback, detect, resume) so no frame is skipped; read capture fps from the file and apply the time scale.
- `draw.ts`: skeleton overlay; plot of hip/toe for the last jump with fitted parabolas.
- `main.ts`: source picker (front/back camera, file), body-height input, status line (fps, "ready", "in the air"), results list (h_P, h_F, flags as warnings).
- Dev server with `@vitejs/plugin-basic-ssl`, `npm run dev` / `npm run build`.

### Task 4: End-to-end test with a fake camera

**Files:** `tools/make_y4m.py`, `e2e/live.spec.ts`, `playwright.config.ts`

- Convert a test video to `.y4m` (Chrome's fake-camera format).
- Playwright with Chrome (`channel: "chrome"`, `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>`): open the app, start the camera, expect one jump with height within ±5 cm of the offline evaluation result.
- Same for file mode with the 120 fps slow-motion recording: expect heights within ±2 cm of the offline result.
