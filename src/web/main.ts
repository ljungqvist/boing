import "./style.css";
import { findJumps, type Jump, type JumpFlag } from "../analysis/jumps";
import { toSignals } from "../analysis/signals";
import { JumpTracker } from "../analysis/tracker";
import type { Landmark, PoseFrame, Signals } from "../analysis/types";
import { startCamera, type CameraSession, type Facing } from "./camera";
import { drawJumpPlot, drawSkeleton } from "./draw";
import { Feedback, WakeLock } from "./feedback";
import { processFile } from "./file";
import { withTimeout } from "./load";
import { ICONS, renderIcons } from "./icons";
import { Pose, type ModelKind } from "./pose";
import { choosePiece, RollingRecorder } from "./recorder";
import { AFTER, BEFORE, MOVEMENT_REJECT, REJECT, Refiner, type RefineResult } from "./refiner";

const REJECT_TEXT: Partial<Record<JumpFlag, string>> = {
  "not-parabola": "no free-fall curve",
  "few-frames": "too short",
  "g-implausible": "speed doesn't match gravity",
  "out-of-view": "not fully in view",
  "inconsistent": "inconsistent flight",
  "poor-fit": "unsteady body points",
};
/**
 * Notes shown with a result. Only about the setup, never about how to jump:
 * jump technique is up to the athlete and their coach.
 */
const NOTE_TEXT: Partial<Record<JumpFlag, string>> = {
  "camera-moved": "The camera moved during this jump; the result may be less accurate.",
};
/** Below this many analysed frames per second, jumps get too few frames in the air. */
const MIN_FPS = 22;
/** How long the latest height stays on top of the video. */
const FLASH_MS = 5000;
/** Live sessions keep this much pose data for "Save session". */
const SESSION_SECONDS = 180;
/** Recorded piece length and stagger (seconds); jump windows up to PIECE − STAGGER fit in one piece. */
const PIECE = 6;
const STAGGER = 3;
/** Debug: `?refine=off` measures from the live analysis only, as before continuous recording. */
const REFINE = new URLSearchParams(location.search).get("refine") !== "off";

/** How a jump was measured. */
interface Measurement {
  /** Measured again from the recording, using every recorded frame. */
  refined: boolean;
  /** Refinement was tried and failed: the live result, from fewer frames. */
  approximate: boolean;
  /** Frames in the air in the live analysis, and in the refined one. */
  framesLive: number;
  framesRefined: number | null;
}

interface ResultEntry extends Measurement {
  hPrimary: number;
  hFlight: number;
  flight: number;
  fps: number;
  flags: JumpFlag[];
  accepted: boolean;
}

/** State exposed for end-to-end tests and debugging. */
const app = {
  state: "idle" as "idle" | "loading" | "live" | "processing" | "done" | "error",
  results: [] as ResultEntry[],
  error: "",
  /** Recent analysed frames (live mode). */
  frames: [] as PoseFrame[],
  /** How each live jump was measured (refinement diagnostics, also in "Save session"). */
  measurements: [] as Record<string, unknown>[],
};
(window as unknown as { boing: typeof app }).boing = app;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const stage = $<HTMLDivElement>("stage");
const placeholder = $<HTMLDivElement>("placeholder");
const status = $<HTMLDivElement>("status");
const flash = $<HTMLDivElement>("flash");
const sessionEl = $<HTMLDivElement>("session");
const summaryEl = $<HTMLDivElement>("summary");
const chipsEl = $<HTMLDivElement>("chips");
const startBtn = $<HTMLButtonElement>("start");
const soundBtn = $<HTMLButtonElement>("sound");
const details = $<HTMLElement>("details");
const menuSheet = $<HTMLElement>("menu-sheet");
const ignoredEl = $<HTMLDetailsElement>("ignored");

renderIcons();

const poses: Partial<Record<ModelKind, Promise<Pose>>> = {};
/** Latest loading step, shown in the status line until the model is ready. */
let poseStep = "Loading…";
/** Debug: `?delegate=cpu` forces the CPU (e.g. to test slow-phone behaviour). */
const delegates: ("GPU" | "CPU")[] = new URLSearchParams(location.search).get("delegate") === "cpu" ? ["CPU"] : ["GPU", "CPU"];
const getPose = (k: ModelKind) =>
  (poses[k] ??= Pose.create(k, (text) => {
    poseStep = text;
    if (app.state === "loading") setStatus(text, "idle");
  }, delegates).catch((e) => {
    delete poses[k]; // allow a retry
    throw e;
  }));
const feedback = new Feedback(localStorage.getItem("boing.sound") !== "off");
const wakeLock = new WakeLock();

let facing: Facing = "user";
let camera: CameraSession | null = null;
let abort: AbortController | null = null;
let flashTimer: number | undefined;
/** Accepted jumps of this session, with the data needed for the detail view. */
let jumps: { jump: Jump; signals: Signals; fps: number; how?: Measurement }[] = [];
let ignored = 0;
/** Pose data of the current/last live session, for "Save session". */
let session: {
  frames: PoseFrame[]; width: number; height: number; meta: Record<string, unknown>; jumps: Record<string, unknown>[];
} | null = null;
let recorder: RollingRecorder | null = null;
/** Cancels refinements of the current results (new session or file). */
let refineAbort = new AbortController();
/** Live jumps waiting for their refined result. */
let pending = 0;

/** Decodes recorded pieces when WebCodecs can't (fallback). */
const refineVideo = document.createElement("video");
refineVideo.className = "offscreen";
refineVideo.muted = true;
refineVideo.playsInline = true;
document.body.append(refineVideo);

type Pill = "idle" | "ready" | "adjust" | "air" | "error";
function setStatus(text: string, pill: Pill = "idle", state?: typeof app.state) {
  if (status.textContent !== text) status.textContent = text;
  status.className = `pill ${pill}`;
  if (state) app.state = state;
}

function setRunning(running: boolean) {
  startBtn.classList.toggle("running", running);
  startBtn.setAttribute("aria-label", running ? "Stop" : "Start");
  placeholder.hidden = running || !!video.src || !!video.srcObject;
}

async function stopAll() {
  liveRun++; // cancels a live start that is still loading
  abort?.abort();
  abort = null;
  recorder?.stop(); // finished pieces stay available for jumps still being measured
  camera?.stop();
  camera = null;
  video.pause();
  wakeLock.release();
  setRunning(false);
}

function clearResults() {
  refineAbort.abort();
  refineAbort = new AbortController();
  pending = 0;
  recorder = null;
  app.results = [];
  jumps = [];
  ignored = 0;
  chipsEl.innerHTML = "";
  sessionEl.hidden = true;
  ignoredEl.hidden = true;
  ignoredEl.querySelector("ul")!.innerHTML = "";
  flash.hidden = true;
  details.hidden = true;
}

/** Size and place the skeleton canvas over the visible (letterboxed) video. */
function fitOverlay() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  const k = Math.min(W / vw, H / vh);
  if (overlay.width !== vw) overlay.width = vw;
  if (overlay.height !== vh) overlay.height = vh;
  Object.assign(overlay.style, { width: `${vw * k}px`, height: `${vh * k}px`, left: `${(W - vw * k) / 2}px`, top: `${(H - vh * k) / 2}px` });
}
window.addEventListener("resize", fitOverlay);

const LIVE_ONLY: Measurement = { refined: false, approximate: false, framesLive: 0, framesRefined: null };

function addResult(
  j: Jump, fps: number, frames: PoseFrame[], size: { width: number; height: number }, live: boolean,
  how: Measurement = { ...LIVE_ONLY, framesLive: j.airborneFrames },
) {
  const accepted = !j.flags.some((f) => REJECT.includes(f));
  app.results.push({ hPrimary: j.hPrimary, hFlight: j.hFlight, flight: j.tOn - j.tOff, fps, flags: j.flags, accepted, ...how });
  if (!accepted) {
    ignored++;
    ignoredEl.hidden = false;
    ignoredEl.querySelector("summary")!.textContent = `${ignored} other movement${ignored > 1 ? "s" : ""} ignored`;
    const reason = j.flags.map((f) => REJECT_TEXT[f]).filter(Boolean).join(", ");
    const item = document.createElement("li");
    item.textContent = `at ${j.tOff.toFixed(1)} s: ${reason} (${(j.hPrimary * 100).toFixed(0)} cm, g ${j.gImplied.toFixed(1)})`;
    ignoredEl.querySelector("ul")!.prepend(item);
    return;
  }
  jumps.push({ jump: j, signals: toSignals({ ...size, fps, frames }), fps, how });
  renderSession();
  if (live) {
    showFlash(j.hPrimary, how.approximate);
    feedback.announce(j.hPrimary);
  }
}

/**
 * Live jumps worth measuring again: accepted ones, and ones rejected only for what more frames can
 * fix (too few frames, noisy points or edges at the live frame rate).
 */
const REFINABLE: JumpFlag[] = ["few-frames", "inconsistent", "poor-fit"];
function refinable(j: Jump): boolean {
  return j.flags.filter((f) => REJECT.includes(f)).every((f) => REFINABLE.includes(f));
}

/**
 * Measure a live jump again from the recording: wait until a finished piece covers it,
 * analyse every frame of that stretch, and show that result. Falls back to the live result.
 */
async function refineLive(
  rec: RollingRecorder, refiner: Refiner,
  j: Jump, fps: number, frames: PoseFrame[], size: { width: number; height: number },
) {
  const signal = refineAbort.signal;
  const log: Record<string, unknown> = {
    tOff: j.tOff, hLive: j.hPrimary, hFlightLive: j.hFlight, framesLive: j.airborneFrames, fpsLive: fps, flagsLive: j.flags,
  };
  session?.jumps.push(log);
  pending++;
  showMeasuring();
  let result: RefineResult;
  const waitStart = performance.now();
  let piece = choosePiece(rec.pieces(), j.tOff - BEFORE, j.tOn + AFTER);
  while (!piece && !rec.error && performance.now() - waitStart < (PIECE + 1) * 1000 && !signal.aborted) {
    await new Promise((r) => setTimeout(r, 250));
    piece = choosePiece(rec.pieces(), j.tOff - BEFORE, j.tOn + AFTER);
  }
  log.waitMs = Math.round(performance.now() - waitStart);
  if (signal.aborted) return;
  if (!piece) result = { error: rec.error ? `recording: ${rec.error}` : "no-piece", ms: 0 };
  else {
    log.piece = { start: piece.start, end: piece.end, bytes: piece.blob?.size, type: piece.blob?.type };
    result = await refiner.refine(j, piece, signal);
  }
  if (signal.aborted) return;
  pending--;
  log.ms = result.ms;
  if ("jump" in result) {
    const r = result.jump;
    Object.assign(log, {
      h: r.hPrimary, hFlight: r.hFlight, frames: r.airborneFrames, fps: result.fps, offset: result.offset, flags: r.flags,
      decoder: result.decoder, analysed: result.frames.length, model: result.model,
      // The analysed frames, to replay the refinement offline (tools/replay.ts).
      refined: { width: result.size.width, height: result.size.height, fps: result.fps, start: piece!.start, frames: result.frames },
    });
    addResult(r, result.fps, result.frames, result.size, true,
      { refined: true, approximate: false, framesLive: j.airborneFrames, framesRefined: r.airborneFrames });
    return;
  }
  Object.assign(log, { error: result.error, flags: result.flags });
  if (result.flags?.some((f) => MOVEMENT_REJECT.includes(f))) {
    // The movement itself can't be measured: listed as ignored (with the re-measured heights, at the live
    // time), the live height isn't shown instead.
    const r = result.rejected ?? j;
    addResult({ ...r, tOff: j.tOff, tOn: j.tOn, flags: result.flags }, fps, frames, size, true, { ...LIVE_ONLY, framesLive: j.airborneFrames });
    if (pending === 0) flash.hidden = true; // it was "Measuring…"
    return;
  }
  console.warn("refinement failed, using the live result", result);
  const accepted = !j.flags.some((f) => REJECT.includes(f));
  addResult(j, fps, frames, size, true,
    { refined: false, approximate: accepted, framesLive: j.airborneFrames, framesRefined: null });
  if (!accepted && pending === 0) flash.hidden = true; // it was "Measuring…"
}

function renderSession() {
  const hs = jumps.map((x) => x.jump.hPrimary * 100);
  const best = Math.max(...hs);
  const avg = hs.reduce((a, b) => a + b, 0) / hs.length;
  sessionEl.hidden = hs.length === 0;
  summaryEl.innerHTML = `<b>${hs.length}</b> jump${hs.length === 1 ? "" : "s"} · Best <b>${best.toFixed(1)}</b> · Average <b>${avg.toFixed(1)}</b> cm`;
  chipsEl.innerHTML = "";
  hs.forEach((h, i) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (h === best ? " best" : "") + (i === hs.length - 1 ? " latest" : "");
    chip.textContent = (jumps[i].how?.approximate ? "≈" : "") + h.toFixed(1);
    chip.addEventListener("click", () => showDetails(i));
    chipsEl.append(chip);
  });
  chipsEl.scrollLeft = chipsEl.scrollWidth;
}

function showDetails(i: number) {
  const { jump: j, signals, fps, how } = jumps[i];
  const notes = j.flags.map((f) => NOTE_TEXT[f]).filter(Boolean);
  if (how?.approximate) notes.push("Measured from the live analysis only, with fewer frames; the result may be less accurate.");
  const frames = how?.refined
    ? `${how.framesRefined} (live analysis: ${how.framesLive})`
    : `${j.airborneFrames}`;
  details.querySelector("h2")!.textContent = `Jump ${i + 1} of ${jumps.length}`;
  details.querySelector(".sheet-body")!.innerHTML = `
    <div class="detail-height">${(j.hPrimary * 100).toFixed(1)}<small> cm</small></div>
    <dl class="rows">
      <dt>Flight-time height</dt><dd>${(j.hFlight * 100).toFixed(1)} cm</dd>
      <dt>Time in the air</dt><dd>${((j.tOn - j.tOff) * 1000).toFixed(0)} ms</dd>
      <dt>Frame rate</dt><dd>${fps.toFixed(0)} fps</dd>
      <dt>Frames in the air</dt><dd>${frames}</dd>
    </dl>
    ${notes.map((n) => `<p class="note">${n}</p>`).join("")}
    <canvas id="plot"></canvas>
    <div class="legend"><span><i style="background:#4a90d9"></i>Hips</span><span><i style="background:#f5a623"></i>Toes</span><span>dashed: takeoff · top · landing</span></div>`;
  menuSheet.hidden = true;
  details.hidden = false;
  fitOverlay(); // the viewer may have changed size (side panel on wide screens)
  drawJumpPlot(details.querySelector<HTMLCanvasElement>("#plot")!, signals, j);
}

/** The latest height in large type on top of the video, for a few seconds. */
function showFlash(h: number, approximate = false) {
  flash.innerHTML = `${approximate ? "≈" : ""}${(h * 100).toFixed(1)}<small>cm</small>`;
  flash.classList.remove("measuring");
  flash.hidden = false;
  flash.style.animation = "none";
  void flash.offsetWidth; // restart the pop-in animation
  flash.style.animation = "";
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (flash.hidden = true), FLASH_MS);
}

/** After a landing, until the refined height is known. */
function showMeasuring() {
  clearTimeout(flashTimer);
  flash.textContent = "Measuring…";
  flash.classList.add("measuring");
  flash.hidden = false;
}

/** Toes clearly above where they stood during the last two seconds. */
function airborne(history: PoseFrame[], lm: Landmark[] | null): boolean {
  if (!lm || lm[31][3] < 0.5 || lm[32][3] < 0.5) return false;
  const toeY = (l: Landmark[]) => (l[31][1] + l[32][1]) / 2;
  const t = history[history.length - 1].t;
  const ys = history.filter((f) => f.lm && f.t > t - 2).map((f) => toeY(f.lm!)).sort((a, b) => b - a);
  const floor = ys[Math.floor(ys.length * 0.25)];
  const body = (lm[29][1] + lm[30][1]) / 2 - lm[0][1];
  return floor - toeY(lm) > 0.04 * body;
}

let liveRun = 0;

async function startLive() {
  await stopAll();
  clearResults();
  setRunning(true);
  const run = ++liveRun;
  // Camera first, so you see yourself while the pose model loads in the background.
  setStatus("Waiting for the camera…", "idle", "loading");
  // Slow phones get the lighter model (remembered from an earlier session).
  // Debug: `?model=full|lite|heavy` pins the model (no automatic switching).
  const pinned = new URLSearchParams(location.search).get("model") as ModelKind | null;
  // With continuous recording, live analysis only has to notice jumps; each one is measured
  // again from the recording with the same model, so keep the more precise full model
  // (lite read jumps up to twice too high on a slow phone).
  const willRecord = REFINE && RollingRecorder.supported();
  const startKind: ModelKind = pinned ?? (!willRecord && localStorage.getItem("boing.model") === "lite" ? "lite" : "full");
  const posePromise = getPose(startKind);
  posePromise.catch(() => {}); // handled below
  try {
    let pose: Pose | null = null;
    let poseSince = 0; // capture time when the current model started analysing
    let switching = false;
    let frameSeen = false;
    const tracker = new JumpTracker();
    const history: PoseFrame[] = [];
    app.frames = history;
    let fpsWindow: number[] = [];
    stage.classList.toggle("mirrored", facing === "user");
    session = { frames: [], width: 0, height: 0, meta: { facing }, jumps: [] };
    app.measurements = session.jumps;
    const rec = session;
    // Continuous recording, to measure each jump again from every recorded frame.
    let recording: RollingRecorder | null = null;
    // Refinement borrows the live pose instance; live analysis pauses meanwhile.
    let refining = false;
    const refiner = new Refiner(async () => {
      if (!pose) throw new Error("pose model not loaded");
      return pose;
    }, refineVideo, 15_000, (busy) => {
      refining = busy;
      if (busy) return;
      // Fresh frame-rate measurement after the pause, so it doesn't look like a slow phone.
      fpsWindow = [];
      poseSince = 0;
    });
    let lag = 0; // performance.now() minus frame time, seconds

    camera = await withTimeout(startCamera(video, facing, (t) => {
      if (run !== liveRun) return;
      frameSeen = true;
      fitOverlay();
      if (!pose) {
        setStatus(poseStep, "idle", "loading");
        return;
      }
      if (refining) {
        drawSkeleton(overlay, null, false);
        setStatus("Measuring…", "idle", "live");
        return;
      }
      const lm = pose.detect(video, t * 1000);
      lag = performance.now() / 1000 - t;
      const frame = { t, lm };
      rec.width = video.videoWidth;
      rec.height = video.videoHeight;
      rec.frames.push(frame);
      if (rec.frames[0].t < t - SESSION_SECONDS) rec.frames.shift();
      history.push(frame);
      while (history[0].t < t - 20) history.shift();
      fpsWindow.push(t);
      fpsWindow = fpsWindow.filter((x) => x > t - 1);
      const fps = fpsWindow.length;
      // After a short warm-up, switch to the lite model if this phone can't keep up.
      if (!poseSince) poseSince = t;
      // Recording starts once the model has been running for a moment: starting it together
      // with the model's first detections stalled the camera's frames for good (Chrome).
      if (t - poseSince > 1) recording?.start();
      if (!pinned && !willRecord && pose.kind !== "lite" && !switching && t - poseSince > 3 && fps < MIN_FPS) {
        switching = true;
        localStorage.setItem("boing.model", "lite");
        void getPose("lite").then((p) => {
          if (run !== liveRun) return;
          p.resetClock();
          pose = p;
          poseSince = 0;
          rec.meta.model = "lite";
          rec.meta.delegate = p.delegate;
        });
      }

      const size = { width: video.videoWidth, height: video.videoHeight };
      for (const j of tracker.push(frame, size)) {
        if (recording && refinable(j)) void refineLive(recording, refiner, j, fps, [...history], size);
        else addResult(j, fps, [...history], size, true);
      }

      const inAir = airborne(history, lm);
      drawSkeleton(overlay, lm, inAir);
      const visible = (i: number) => !!lm && lm[i][3] > 0.5;
      if (!lm) setStatus("Looking for you…", "idle", "live");
      else if (!visible(31) || !visible(32)) setStatus("Feet not visible · step back", "adjust", "live");
      else if (!visible(23) || !visible(24)) setStatus("Hips not visible · step back", "adjust", "live");
      else if (inAir) setStatus("Jump!", "air", "live");
      else if (t - poseSince > 2 && fps < MIN_FPS) setStatus(`Ready · low frame rate (${fps} fps)`, "adjust", "live");
      else setStatus("Ready", "ready", "live");
    }), 60_000, "Starting the camera (was the permission question answered?)");
    placeholder.hidden = true;
    void wakeLock.acquire();
    if (REFINE && RollingRecorder.supported()) {
      const cam = camera;
      // Piece times on the frame timeline: capture times share performance.now()'s clock.
      recording = recorder = new RollingRecorder(cam.stream, {
        piece: PIECE, stagger: STAGGER,
        clock: () => performance.now() / 1000 - (cam.timing.source === "captureTime" ? 0 : lag),
      });
    }
    session.meta.recording = { type: recorder?.mimeType ?? null, enabled: REFINE };
    setStatus(poseStep, "idle", "loading");

    // A camera that starts but never delivers a picture would otherwise look like endless loading.
    setTimeout(() => {
      if (run === liveRun && camera && !frameSeen) fail(new Error("The camera started but sends no picture. Try Stop and Start again."));
    }, 10_000);

    pose = await posePromise;
    if (run !== liveRun) return;
    pose.resetClock();
    session.meta.delegate = pose.delegate;
    session.meta.model = pose.kind;
  } catch (e) {
    if (run === liveRun) fail(e);
  }
}

async function openFile(file: File) {
  await stopAll();
  clearResults();
  stage.classList.remove("mirrored");
  setRunning(true);
  setStatus("Loading…", "idle", "loading");
  try {
    const pose = await getPose("heavy");
    pose.resetClock();
    setStatus("Analysing · 0 %", "idle", "processing");
    const frames: PoseFrame[] = [];
    abort = new AbortController();
    const r = await processFile(
      file, video,
      (t) => {
        fitOverlay();
        const lm = pose.detect(video, t * 1000);
        drawSkeleton(overlay, lm, false);
        frames.push({ t, lm });
      },
      (p) => setStatus(`Analysing · ${Math.round(p * 100)} %`, "idle", "processing"),
      abort.signal,
    );
    const scale = r.timeScale ?? 1;
    for (const f of frames) f.t *= scale;
    const duration = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
    const fps = (frames.length - 1) / (duration || 1);
    const size = { width: video.videoWidth, height: video.videoHeight };
    for (const j of findJumps(toSignals({ ...size, fps, frames }))) addResult(j, fps, frames, size, false);
    const slow = r.timeScale ? ` · slow motion, captured at ${r.captureFps} fps` : ` · ${fps.toFixed(0)} fps`;
    setStatus(`${jumps.length} jump${jumps.length === 1 ? "" : "s"} found${slow}`, jumps.length ? "ready" : "idle", "done");
    if (jumps.length) showFlash(Math.max(...jumps.map((x) => x.jump.hPrimary)));
  } catch (e) {
    if ((e as Error).name !== "AbortError") fail(e);
  } finally {
    setRunning(false);
  }
}

function saveSession() {
  if (!session || session.frames.length === 0) {
    setStatus("Nothing to save yet", "idle");
    return;
  }
  const meta = { ...session.meta, recordingError: recorder?.error, userAgent: navigator.userAgent, timing: camera?.timing, savedAt: new Date().toISOString() };
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
  void stopAll();
  app.error = String((e as Error)?.message ?? e);
  setStatus(`Error: ${app.error}`, "error", "error");
  setRunning(false);
}

function renderSound() {
  soundBtn.innerHTML = feedback.enabled ? ICONS.soundOn : ICONS.soundOff;
}
renderSound();

startBtn.addEventListener("click", async () => {
  if (startBtn.classList.contains("running")) {
    await stopAll();
    setStatus("Stopped", "idle", "idle");
    return;
  }
  feedback.prime(); // inside the tap, so phones allow sound later
  void startLive();
});
$("flip").addEventListener("click", () => {
  facing = facing === "user" ? "environment" : "user";
  if (camera) void startLive();
});
soundBtn.addEventListener("click", () => {
  feedback.enabled = !feedback.enabled;
  localStorage.setItem("boing.sound", feedback.enabled ? "on" : "off");
  if (feedback.enabled) feedback.prime();
  renderSound();
});
$("menu").addEventListener("click", () => {
  details.hidden = true;
  menuSheet.hidden = !menuSheet.hidden;
});
document.querySelectorAll(".sheet .close").forEach((b) =>
  b.addEventListener("click", () => ((b.closest(".sheet") as HTMLElement).hidden = true)),
);
$("save").addEventListener("click", saveSession);
$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = ""; // allow opening the same file again
  if (f) void openFile(f);
});
