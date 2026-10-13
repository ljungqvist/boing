import "./style.css";
import { findJumps, type Jump, type JumpFlag } from "../analysis/jumps";
import { toSignals } from "../analysis/signals";
import { JumpTracker } from "../analysis/tracker";
import type { Landmark, PoseFrame, Signals } from "../analysis/types";
import { startCamera, type CameraSession, type Facing } from "./camera";
import { drawJumpPlot, drawSkeleton } from "./draw";
import { Feedback, WakeLock } from "./feedback";
import { processFile } from "./file";
import { ICONS, renderIcons } from "./icons";
import { Pose, type ModelKind } from "./pose";

/** Flags that mean "this was not a jump", rather than "a jump with a caveat". */
const REJECT: JumpFlag[] = ["not-parabola", "few-frames", "g-implausible"];
const REJECT_TEXT: Partial<Record<JumpFlag, string>> = {
  "not-parabola": "no free-fall curve",
  "few-frames": "too short",
  "g-implausible": "speed doesn't match gravity",
};
/**
 * Notes shown with a result. Only about the setup, never about how to jump:
 * jump technique is up to the athlete and their coach.
 */
const NOTE_TEXT: Partial<Record<JumpFlag, string>> = {
  "camera-moved": "The camera moved during this jump; the result may be less accurate.",
};
/** How long the latest height stays on top of the video. */
const FLASH_MS = 5000;
/** Live sessions keep this much pose data for "Save session". */
const SESSION_SECONDS = 180;

interface ResultEntry {
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
const statureInput = $<HTMLInputElement>("stature");

renderIcons();

const poses: Partial<Record<ModelKind, Promise<Pose>>> = {};
const getPose = (k: ModelKind) => (poses[k] ??= Pose.create(k));
const feedback = new Feedback(localStorage.getItem("boing.sound") !== "off");
const wakeLock = new WakeLock();

let facing: Facing = "user";
let camera: CameraSession | null = null;
let abort: AbortController | null = null;
let flashTimer: number | undefined;
/** Accepted jumps of this session, with the data needed for the detail view. */
let jumps: { jump: Jump; signals: Signals; fps: number }[] = [];
let ignored = 0;
/** Pose data of the current/last live session, for "Save session". */
let session: { frames: PoseFrame[]; width: number; height: number; meta: Record<string, unknown> } | null = null;

const stature = () => {
  const cm = Number(statureInput.value);
  return cm >= 100 && cm <= 230 ? cm / 100 : 1.75;
};

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
  abort?.abort();
  abort = null;
  camera?.stop();
  camera = null;
  video.pause();
  wakeLock.release();
  setRunning(false);
}

function clearResults() {
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

function addResult(j: Jump, fps: number, frames: PoseFrame[], size: { width: number; height: number }, live: boolean) {
  const accepted = !j.flags.some((f) => REJECT.includes(f));
  app.results.push({ hPrimary: j.hPrimary, hFlight: j.hFlight, flight: j.tOn - j.tOff, fps, flags: j.flags, accepted });
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
  jumps.push({ jump: j, signals: toSignals({ ...size, fps, frames }), fps });
  renderSession();
  if (live) {
    showFlash(j.hPrimary);
    feedback.announce(j.hPrimary);
  }
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
    chip.textContent = h.toFixed(1);
    chip.addEventListener("click", () => showDetails(i));
    chipsEl.append(chip);
  });
  chipsEl.scrollLeft = chipsEl.scrollWidth;
}

function showDetails(i: number) {
  const { jump: j, signals, fps } = jumps[i];
  const notes = j.flags.map((f) => NOTE_TEXT[f]).filter(Boolean);
  details.querySelector("h2")!.textContent = `Jump ${i + 1} of ${jumps.length}`;
  details.querySelector(".sheet-body")!.innerHTML = `
    <div class="detail-height">${(j.hPrimary * 100).toFixed(1)}<small> cm</small></div>
    <dl class="rows">
      <dt>Flight-time height</dt><dd>${(j.hFlight * 100).toFixed(1)} cm</dd>
      <dt>Time in the air</dt><dd>${((j.tOn - j.tOff) * 1000).toFixed(0)} ms</dd>
      <dt>Frame rate</dt><dd>${fps.toFixed(0)} fps</dd>
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
function showFlash(h: number) {
  flash.innerHTML = `${(h * 100).toFixed(1)}<small>cm</small>`;
  flash.hidden = false;
  flash.style.animation = "none";
  void flash.offsetWidth; // restart the pop-in animation
  flash.style.animation = "";
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (flash.hidden = true), FLASH_MS);
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

async function startLive() {
  await stopAll();
  clearResults();
  setRunning(true);
  setStatus("Loading…", "idle", "loading");
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

    camera = await startCamera(video, facing, (t) => {
      fitOverlay();
      const lm = pose.detect(video, t * 1000);
      const frame = { t, lm };
      rec.width = video.videoWidth;
      rec.height = video.videoHeight;
      rec.frames.push(frame);
      if (rec.frames[0].t < t - SESSION_SECONDS) rec.frames.shift();
      history.push(frame);
      while (history[0].t < t - 20) history.shift();
      fpsWindow.push(t);
      fpsWindow = fpsWindow.filter((x) => x > t - 1);

      const size = { width: video.videoWidth, height: video.videoHeight };
      for (const j of tracker.push(frame, size)) addResult(j, fpsWindow.length, [...history], size, true);

      const inAir = airborne(history, lm);
      drawSkeleton(overlay, lm, inAir);
      const visible = (i: number) => !!lm && lm[i][3] > 0.5;
      if (!lm) setStatus("Looking for you…", "idle", "live");
      else if (!visible(31) || !visible(32)) setStatus("Feet not visible · step back", "adjust", "live");
      else if (!visible(23) || !visible(24)) setStatus("Hips not visible · step back", "adjust", "live");
      else if (inAir) setStatus("Jump!", "air", "live");
      else setStatus("Ready", "ready", "live");
    });
    await wakeLock.acquire();
    placeholder.hidden = true;
  } catch (e) {
    fail(e);
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
    for (const j of findJumps(toSignals({ ...size, fps, frames }), { stature: stature() })) addResult(j, fps, frames, size, false);
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
