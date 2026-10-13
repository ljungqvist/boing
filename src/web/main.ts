import "./style.css";
import { findJumps, type Jump, type JumpFlag } from "../analysis/jumps";
import { toSignals } from "../analysis/signals";
import { JumpTracker } from "../analysis/tracker";
import type { PoseFrame } from "../analysis/types";
import { startCamera, type CameraSession, type Facing } from "./camera";
import { drawJumpPlot, drawSkeleton } from "./draw";
import { processFile } from "./file";
import { Pose, type ModelKind } from "./pose";

/** Flags that mean "this was not a jump", rather than "a jump with a caveat". */
const REJECT: JumpFlag[] = ["not-parabola", "few-frames", "g-implausible"];
const REJECT_TEXT: Partial<Record<JumpFlag, string>> = {
  "not-parabola": "no free-fall curve",
  "few-frames": "too short",
  "g-implausible": "speed doesn't match gravity",
};
/** How long the latest height stays on top of the video. */
const FLASH_MS = 5000;
/** Live sessions keep this much pose data for "Save session". */
const SESSION_SECONDS = 180;
const WARNING_TEXT: Partial<Record<JumpFlag, string>> = {
  "poor-fit": "Unclear flight curve: keep your legs straight in the air.",
  disagree: "Landing differs from takeoff: land with straight legs, like you took off.",
  "camera-moved": "The camera seems to have moved.",
};

interface ResultEntry {
  hPrimary: number;
  hFlight: number;
  flight: number;
  fps: number;
  flags: JumpFlag[];
  accepted: boolean;
}

/** State exposed for end-to-end tests. */
const app = {
  state: "idle" as "idle" | "loading" | "live" | "processing" | "done" | "error",
  results: [] as ResultEntry[],
  error: "",
  /** Recent analysed frames (live mode), for debugging and tests. */
  frames: [] as PoseFrame[],
};
(window as unknown as { boing: typeof app }).boing = app;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const stage = $<HTMLDivElement>("stage");
const status = $<HTMLDivElement>("status");
const resultsEl = $<HTMLOListElement>("results");
const ignoredEl = $<HTMLDetailsElement>("ignored");
const flash = $<HTMLDivElement>("flash");
const plot = $<HTMLCanvasElement>("plot");
const statureInput = $<HTMLInputElement>("stature");

const poses: Partial<Record<ModelKind, Promise<Pose>>> = {};
const getPose = (k: ModelKind) => (poses[k] ??= Pose.create(k));

let camera: CameraSession | null = null;
let abort: AbortController | null = null;
let ignored = 0;
let flashTimer: number | undefined;
/** Pose data of the current/last live session, for "Save session". */
let session: { frames: PoseFrame[]; width: number; height: number; meta: Record<string, unknown> } | null = null;

const stature = () => {
  const cm = Number(statureInput.value);
  return cm >= 100 && cm <= 230 ? cm / 100 : 1.75;
};

function setStatus(text: string, state?: typeof app.state) {
  status.textContent = text;
  if (state) app.state = state;
}

async function stopAll() {
  abort?.abort();
  abort = null;
  camera?.stop();
  camera = null;
  video.pause();
  video.removeAttribute("src");
}

function clearResults() {
  app.results = [];
  resultsEl.innerHTML = "";
  ignored = 0;
  ignoredEl.hidden = true;
  ignoredEl.querySelector("ul")!.innerHTML = "";
  plot.hidden = true;
  flash.hidden = true;
}

function addResult(j: Jump, fps: number, frames: PoseFrame[], size: { width: number; height: number }) {
  const accepted = !j.flags.some((f) => REJECT.includes(f));
  app.results.push({ hPrimary: j.hPrimary, hFlight: j.hFlight, flight: j.tOn - j.tOff, fps, flags: j.flags, accepted });
  if (!accepted) {
    ignored++;
    ignoredEl.hidden = false;
    ignoredEl.querySelector("summary")!.textContent = `${ignored} other movement${ignored > 1 ? "s" : ""} ignored (not a clean jump)`;
    const reason = j.flags.map((f) => REJECT_TEXT[f]).filter(Boolean).join(", ");
    const item = document.createElement("li");
    item.textContent = `at ${j.tOff.toFixed(1)} s: ${reason} (would be ${(j.hPrimary * 100).toFixed(0)} cm, g ${j.gImplied.toFixed(1)})`;
    ignoredEl.querySelector("ul")!.prepend(item);
    return;
  }
  showFlash(j.hPrimary);
  const n = resultsEl.children.length + 1;
  const li = document.createElement("li");
  li.className = "result";
  const warnings = j.flags.map((f) => WARNING_TEXT[f]).filter(Boolean);
  li.innerHTML = `
    <div class="height">${(j.hPrimary * 100).toFixed(1)} <small>cm</small></div>
    <div class="detail">Jump ${n} · flight-time height ${(j.hFlight * 100).toFixed(1)} cm ·
      in the air ${((j.tOn - j.tOff) * 1000).toFixed(0)} ms · ${fps.toFixed(0)} fps</div>
    ${warnings.map((w) => `<div class="warning">${w}</div>`).join("")}`;
  const signals = toSignals({ ...size, fps, frames });
  const show = () => {
    plot.hidden = false;
    drawJumpPlot(plot, signals, j);
    for (const el of resultsEl.children) el.classList.toggle("selected", el === li);
  };
  li.addEventListener("click", show);
  resultsEl.prepend(li);
  show();
}

async function startLive(facing: Facing) {
  await stopAll();
  clearResults();
  setStatus("Loading pose model…", "loading");
  try {
    const pose = await getPose("full");
    pose.resetClock();
    const tracker = new JumpTracker({ stature: stature() });
    const history: PoseFrame[] = [];
    app.frames = history;
    let fpsWindow: number[] = [];
    stage.classList.toggle("mirrored", facing === "user");

    session = { frames: [], width: 0, height: 0, meta: { facing } };
    const rec = session;
    camera = await startCamera(video, facing, (t, dropped) => {
      const lm = pose.detect(video, t * 1000);
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      drawSkeleton(overlay, lm, false);

      const frame = { t, lm };
      rec.width = video.videoWidth;
      rec.height = video.videoHeight;
      rec.frames.push(frame);
      if (rec.frames.length > 1 && rec.frames[0].t < t - SESSION_SECONDS) rec.frames.shift();
      history.push(frame);
      while (history[0].t < t - 20) history.shift();
      fpsWindow.push(t);
      fpsWindow = fpsWindow.filter((x) => x > t - 1);

      const size = { width: video.videoWidth, height: video.videoHeight };
      for (const j of tracker.push(frame, size)) addResult(j, fpsWindow.length, [...history], size);

      const feet = lm && lm[31][3] > 0.5 && lm[32][3] > 0.5;
      setStatus(
        !lm ? "No person in view." :
        !feet ? "Feet not visible: move back or tilt the camera down." :
        `Ready: jump with hands on hips. ${fpsWindow.length} fps analysed${dropped ? ", frames dropped" : ""}` +
          ` (${camera?.timing.source ?? "…"}${camera?.timing.stalled ? `, ${camera.timing.stalled} stalled timestamps` : ""}).`,
        "live",
      );
    });
  } catch (e) {
    fail(e);
  }
}

async function openFile(file: File) {
  await stopAll();
  clearResults();
  stage.classList.remove("mirrored");
  setStatus("Loading pose model…", "loading");
  try {
    const pose = await getPose("heavy");
    pose.resetClock();
    const frames: PoseFrame[] = [];
    abort = new AbortController();
    setStatus("Analysing every frame…", "processing");
    const r = await processFile(
      file, video,
      (t) => {
        const lm = pose.detect(video, t * 1000);
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        drawSkeleton(overlay, lm, false);
        frames.push({ t, lm });
      },
      (p) => setStatus(`Analysing every frame… ${Math.round(p * 100)} %`),
      abort.signal,
    );
    const scale = r.timeScale ?? 1;
    for (const f of frames) f.t *= scale;
    const duration = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
    const fps = (frames.length - 1) / (duration || 1);
    const size = { width: video.videoWidth, height: video.videoHeight };
    const jumps = findJumps(toSignals({ ...size, fps, frames }), { stature: stature() });
    jumps.forEach((j) => addResult(j, fps, frames, size));
    const slow = r.timeScale ? ` Slow motion: captured at ${r.captureFps} fps.` : "";
    const found = app.results.filter((x) => x.accepted).length;
    setStatus(`Done: ${r.frameCount} frames, ${fps.toFixed(0)} fps real time.${slow} ${found} jump${found === 1 ? "" : "s"} found.`, "done");
  } catch (e) {
    if ((e as Error).name !== "AbortError") fail(e);
  }
}

/** The latest height in large type on top of the video, for a few seconds. */
function showFlash(h: number) {
  flash.innerHTML = `${(h * 100).toFixed(1)} <small>cm</small>`;
  flash.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (flash.hidden = true), FLASH_MS);
}

function saveSession() {
  if (!session || session.frames.length === 0) {
    setStatus("Nothing to save yet: start a camera first.");
    return;
  }
  const meta = { ...session.meta, userAgent: navigator.userAgent, timing: camera?.timing, savedAt: new Date().toISOString() };
  const fps = session.frames.length / Math.max(1e-3, session.frames[session.frames.length - 1].t - session.frames[0].t);
  const blob = new Blob([JSON.stringify({ ...session, fps, meta })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `boing-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function fail(e: unknown) {
  console.error(e);
  app.error = String((e as Error)?.message ?? e);
  setStatus(`Error: ${app.error}`, "error");
}

$("front").addEventListener("click", () => startLive("user"));
$("back").addEventListener("click", () => startLive("environment"));
$("save").addEventListener("click", saveSession);
$("stop").addEventListener("click", async () => { await stopAll(); setStatus("Stopped.", "idle"); });
$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) openFile(f);
});
