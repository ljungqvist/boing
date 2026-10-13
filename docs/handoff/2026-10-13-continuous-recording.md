# Handoff: continuous recording for Boing

You're continuing work on **Boing**, a browser app that measures countermovement-jump
height from the phone camera (repo `ljungqvist/boing`, local `~/code/boing`).

## Your task

Implement `docs/superpowers/plans/2026-10-13-continuous-recording.md`, task by task.
Read the plan fully first, then `README.md`, `docs/evaluation/2026-10-13-first-evaluation.md`
(why the method works and its limits) and `src/web/main.ts` (live mode today).

## Ground rules from the user

- **Deploy to dev on your own** when a task is finished and tested: merge into `dev`, push.
  Site: https://ljungqvist.github.io/boing/dev/. **Never** push or merge to `main` without
  the user's explicit OK (a friend uses https://ljungqvist.github.io/boing/).
- **No advice on jump technique** in the app. Only setup instructions (hands on hips,
  feet and hips in view, camera still).
- If the user says they're driving: follow the `driving-mode` skill in `~/.agents/skills/`
  (no question dialogs, push notification when done, replies written for read-aloud).
- Global rules in `~/.agents/AGENTS.md` (commits on feature branches, never amend, etc.).

## Environment and tools

- Node + TypeScript: `npm test` (Vitest, unit), `npm run typecheck`, `npm run e2e`
  (Playwright with installed Google Chrome, `channel: "chrome"`, fake camera), `npm run dev`.
- Test data outside the repo in `~/code/data/` (never commit it):
  `e2e/front-jump.y4m` and `e2e/own-two-jumps.y4m` (fake-camera feeds),
  `own/*.mp4` (the user's recordings), `sessions/*.json` (saved phone sessions).
- `npx tsx tools/replay.ts <session.json>` replays a saved phone session through the tracker.
- Python venv `.venv` with MediaPipe for offline evaluation (`tools/extract_pose.py`, `npm run evaluate`).

## Lessons learned (save yourself the time)

- **Check exit codes.** A `grep` on test output once let a failing e2e test through to dev.
  Use the Playwright/Vitest exit code.
- **Chrome's fake camera crops** the picture to the requested resolution. Keep the camera
  request at 1280x720 (also known to arrive uncropped on the user's phone). An e2e test
  guards the aspect ratio.
- **Chrome's fake camera runs 3–9 % slow**, which inflates live heights a little in e2e.
  That's the rig, not the app.
- **CPU throttling doesn't slow GPU pose inference.** To simulate a slow phone, use
  `/?delegate=cpu` (and `?model=full|lite` to pin the model) together with CDP
  `Emulation.setCPUThrottlingRate`.
- The user's phone (Android 10, Chrome) analysed only ~13 fps live. That's the case this
  feature must fix.
- Samsung slow-motion files are handled via `com.android.capture.fps`; don't regress
  `e2e/app.spec.ts` (file test).

## When done

Tell the user in plain words what to test on the phone and ask them to press
"Save session" afterwards if anything looks off.
