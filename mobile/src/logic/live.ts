import type { Jump } from "../../../src/analysis/jumps";
import { JumpTracker } from "../../../src/analysis/tracker";
import type { PoseFrame } from "../../../src/analysis/types";
import { accepted, AFTER, BEFORE, closestJump, frameRate, jumpsIn, MAX_FLIGHT, MOVEMENT_REJECT, PAD, PAD_SHORT, REJECT, refinable } from "./measure";
import type { Size } from "./pose";
import { compactPose } from "./diagnostics";
import { motionSummary, type Sample } from "./motion";
import { liveStatus, type Status } from "./status";
import type { Measured } from "./video";

/** A recording in progress. */
export interface Clip {
  /** Stops the recording; resolves with the finished file's path. */
  stop(): Promise<string>;
}

export interface LiveDeps {
  /** Starts recording the camera. Resolves once recording has started. */
  startClip(): Promise<Clip>;
  /**
   * Pose of every recorded frame between `from` and `to` (seconds from the clip's start), and for
   * the diagnostics: facts about the recorded file (size, rotation, frame rate) and where the time went.
   * `perFrame`: each frame on its own (no tracking lag) instead of tracking the person through the clip.
   */
  analyzeClip(path: string, from: number, to: number, perFrame: boolean): Promise<{
    frames: PoseFrame[]; size: Size; video?: Record<string, unknown>; timing?: Record<string, unknown>;
  }>;
  /** Deletes a finished clip (`hasJumps`: it was measured; a debug setting may keep those). */
  deleteClip(path: string, hasJumps?: boolean): void;
  /** Motion-sensor samples between two times on the frame clock, if the phone's sensors are read. */
  motion?(from: number, to: number): { acc: Sample[]; gyro: Sample[] };
  /** The camera's current settings (exposure time, ISO, frame rates) for the diagnostics, if readable. */
  camera?(): Record<string, unknown> | undefined;
}

export interface LiveEvents {
  status(s: Status): void;
  /** A jump was seen; its height follows. */
  measuring(): void;
  /**
   * A finished measurement (also for rejected movements: check `accepted(m.jump)`). May return a
   * promise for its announcement: after a re-measured jump, the live analysis resumes once it resolves.
   * `measuring`: `measuring()` was called for this jump, so it must get an outcome (height or failure),
   * whatever happened to its re-measurement.
   */
  result(m: Measured, measuring: boolean): void | Promise<void>;
  /** Diagnostics for each live jump (refinement details). */
  log?(entry: Record<string, unknown>): void;
  /**
   * The live analysis isn't needed for a while (`true`: a jump is being measured; nothing is recorded
   * meanwhile) or is needed again (`false`: the next recording runs).
   */
  paused?(on: boolean): void;
  /**
   * The recording's clock shift as learned so far (after each re-measured jump that taught something): worth
   * remembering for this camera and passing as `LiveOptions.clockShift` next time. NaN: the remembered one was wrong.
   */
  clockShift?(seconds: number): void;
}

export interface LiveOptions {
  /** Record clips and measure each jump again from every recorded frame. */
  record?: boolean;
  /**
   * Seconds after which a clip without jumps is replaced by a new one (keeps files small), once
   * nobody is in the picture. Replacing it leaves a moment that can't be re-measured.
   */
  rotateSeconds?: number;
  /** … and while someone is in the picture (and may be about to jump), only after this many seconds. */
  rotateSecondsInView?: number;
  /** Give up re-measuring a jump after this many milliseconds. */
  timeoutMs?: number;
  /**
   * The recording's clock shift remembered for this camera (`LiveEvents.clockShift`), if any: then even the first jump
   * gets the window padded by `PAD_SHORT` instead of `PAD`. If that jump can't be measured, it's forgotten again.
   */
  clockShift?: number;
  /**
   * Re-measure with the pose of each frame on its own first (default): tracking smooths the landmarks, which
   * puts them ≈ 10 ms behind fast movement and drags the feet at takeoff. Where that finds no measurable jump
   * (the person missed in dim light, another person picked), the clip is measured again with tracking.
   */
  perFrame?: boolean;
}

/** Live pose history kept for status, fallback plots and diagnostics (seconds). */
const HISTORY = 20;
/** Give up waiting for a recording to finish after this many milliseconds (the jump still gets an outcome). */
const STOP_TIMEOUT_MS = 10_000;

interface OpenClip {
  clip: Clip;
  /**
   * Live time (frame clock) when recording had started: the clip's t = 0, approximately. NaN until the
   * next frame when it started while the live analysis was paused.
   */
  start: number;
  /** `Date.now()` when recording had started. */
  startedAt: number;
  jumps: Jump[];
}

/**
 * Live measurement: pose frames from the camera go into a `JumpTracker`; each detected jump is
 * measured again from the recording (every recorded frame), and the live result is the fallback.
 * Times are seconds on the camera's frame clock.
 */
export class LiveController {
  private readonly tracker = new JumpTracker();
  private readonly history: PoseFrame[] = [];
  private fpsWindow: number[] = [];
  private firstT = NaN;
  private lastT = NaN;
  private lastAir = -Infinity;
  private lastPerson = -Infinity;
  private clip: OpenClip | null = null;
  private starting = false;
  /** After a failed recording start, wait until this frame time before trying again. */
  private retryAt = -Infinity;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly record: boolean;
  private readonly rotateSeconds: number;
  private readonly rotateSecondsInView: number;
  private readonly timeoutMs: number;
  private readonly perFrame: boolean;
  /**
   * How far the re-measured takeoffs came out from the live ones (seconds, latest last). The recording
   * starts later than `OpenClip.start` says (≈ 0.15–0.2 s on the phone), the same for every clip.
   */
  private offsets: number[] = [];
  /** `offsets` holds only the remembered clock shift (`LiveOptions.clockShift`), not one learned in this run. */
  private seeded = false;
  /** When each jump waiting for its re-measured height was seen (`Date.now()`). */
  private readonly seenAt = new Map<Jump, number>();
  /** Jumps waiting for their re-measured height. */
  pending = 0;
  /**
   * A jump is being measured: no live analysis and no new recording until its height is out. One jump
   * at a time, so it's clear which one a height belongs to.
   */
  private busy = false;

  constructor(private readonly deps: LiveDeps, private readonly events: LiveEvents, opts: LiveOptions = {}) {
    this.record = opts.record ?? true;
    this.rotateSeconds = opts.rotateSeconds ?? 15;
    this.rotateSecondsInView = opts.rotateSecondsInView ?? 60;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    if (opts.clockShift !== undefined && Number.isFinite(opts.clockShift)) {
      this.offsets.push(opts.clockShift);
      this.seeded = true;
    }
    this.perFrame = opts.perFrame ?? true;
  }

  /** The recording's clock shift: the median of the last 5 offsets (0 before the first). */
  private get clockShift(): number {
    const o = this.offsets.slice(-5).sort((a, b) => a - b);
    return o.length ? o[Math.floor(o.length / 2)] : 0;
  }

  /** Padding of the re-measuring window: short once the clock shift is known. */
  private get pad(): number {
    return this.offsets.length > 0 ? PAD_SHORT : PAD;
  }

  /**
   * A jump measured with only the remembered clock shift failed: the shift may be wrong (another phone setting, an
   * update), so the next jump gets the full padding and learns it again.
   */
  private distrustSeed(log: Record<string, unknown>) {
    if (!this.seeded) return;
    this.seeded = false;
    this.offsets = [];
    log.clockShiftForgotten = true;
    this.events.clockShift?.(NaN);
  }

  /** Live analysis rate (frames per second over the last second). */
  get fps(): number {
    return this.fpsWindow.length;
  }

  /** A jump is being measured; the live analysis is paused. */
  get measuring(): boolean {
    return this.busy;
  }

  /** Whether the latest frame shows the person in the air. */
  get airborne(): boolean {
    return this.lastAir === this.lastT;
  }

  /** Recent live frames (oldest first). */
  frames(): PoseFrame[] {
    return [...this.history];
  }

  push(frame: PoseFrame, size: Size): void {
    if (this.stopped) return;
    const t = frame.t;
    // A clip started while paused: its start on the frame clock, from the time since it started.
    if (this.clip && Number.isNaN(this.clip.start)) this.clip.start = t - (Date.now() - this.clip.startedAt) / 1000;
    this.lastT = t;
    if (this.busy) {
      // Only finish the jump's recording (a little after the landing); then measuring starts.
      const c = this.clip;
      if (c && c.jumps.length > 0 && t >= Math.max(...c.jumps.map((j) => j.tOn + AFTER + this.pad + this.clockShift))) void this.rotate();
      return;
    }
    if (Number.isNaN(this.firstT)) this.firstT = t;
    this.history.push(frame);
    while (this.history[0].t < t - HISTORY) this.history.shift();
    this.fpsWindow.push(t);
    this.fpsWindow = this.fpsWindow.filter((x) => x > t - 1);

    const status = liveStatus(this.history, frame.lm, this.fps, t - this.firstT > 2);
    if (status.tone === "air") this.lastAir = t;
    if (frame.lm) this.lastPerson = t;
    this.events.status(status);

    for (const j of this.tracker.push(frame, size)) this.onJump(j, size);

    if (!this.record) return;
    if (!this.clip) {
      if (!this.starting && t >= this.retryAt) void this.startClip();
      return;
    }
    const c = this.clip;
    const lastEnd = Math.max(...c.jumps.map((j) => j.tOn + AFTER + this.pad + this.clockShift));
    // A clip with jumps ends once it covers them; one without is replaced now and then. Not soon while
    // someone is in the picture: people jump every 15–20 s (after hearing the height), and a new clip
    // started in the countermovement lacks the standing before the takeoff.
    const age = t - c.start;
    const quiet = t - this.lastAir > 2 && (t - this.lastPerson > 1 ? age > this.rotateSeconds : age > this.rotateSecondsInView);
    if (c.jumps.length > 0 ? t >= lastEnd : quiet) void this.rotate();
  }

  /** Stops measuring; jumps already recorded are still measured. */
  async stop(): Promise<void> {
    this.stopped = true;
    const c = this.clip;
    this.clip = null;
    if (c) await this.measure(c, await this.stopClip(c));
    await this.queue;
  }

  private onJump(j: Jump, size: Size) {
    const live = this.liveMeasurement(j, size);
    const c = this.clip;
    // The recording must include some standing before takeoff (the floor level).
    if (!c || !refinable(j) || j.tOn - j.tOff > MAX_FLIGHT || j.tOff - 0.5 < c.start) {
      this.events.log?.({
        tOff: j.tOff, hLive: j.hPrimary, framesLive: j.airborneFrames, gLive: j.gImplied, flagsLive: j.flags,
        refined: false, reason: c ? "not-refinable-or-before-clip" : "no-clip",
      });
      this.events.result(live, false);
      return;
    }
    this.pending++;
    this.seenAt.set(j, Date.now());
    this.busy = true;
    this.events.status({ text: "Measuring · not ready", tone: "idle" });
    this.events.measuring();
    c.jumps.push(j);
  }

  private liveMeasurement(j: Jump, size: Size): Measured {
    const frames = this.frames();
    return { jump: j, frames, size, fps: this.fps, refined: false, approximate: false, framesFirst: j.airborneFrames };
  }

  private async startClip() {
    this.starting = true;
    try {
      const clip = await this.deps.startClip();
      if (this.stopped) {
        this.deps.deleteClip(await clip.stop(), false);
        return;
      }
      this.clip = { clip, start: this.busy ? NaN : this.lastT, startedAt: Date.now(), jumps: [] };
    } catch (e) {
      this.retryAt = this.lastT + 5;
      this.events.log?.({ error: `recording: ${String((e as Error)?.message ?? e)}` });
    } finally {
      this.starting = false;
    }
  }

  /**
   * Ends the current clip and starts the next. The old recording is stopped first: cameras
   * record one file at a time (CameraX crashes otherwise). The short gap is right after a
   * jump's landing or during a quiet stretch. A clip with a jump is measured first, with the live
   * analysis paused; the next recording starts after its height has been read out, then the live
   * analysis resumes.
   */
  private async rotate() {
    const old = this.clip;
    if (!old) return;
    this.clip = null;
    this.starting = true; // no new clip from push() until the old one is finished
    let path: string | null;
    try {
      path = await this.stopClip(old);
    } finally {
      this.starting = false;
    }
    if (old.jumps.length === 0) {
      await Promise.all([this.stopped ? null : this.startClip(), this.measure(old, path)]);
      return;
    }
    this.events.paused?.(true);
    try {
      await this.measure(old, path);
    } finally {
      if (!this.stopped) await this.startClip();
      this.resume();
    }
  }

  /** Live analysis from scratch after a measurement (the frames before it are seconds old). */
  private resume() {
    this.busy = false;
    this.tracker.reset();
    this.history.length = 0;
    this.fpsWindow = [];
    this.firstT = NaN;
    this.events.paused?.(false);
  }

  private async stopClip(c: OpenClip): Promise<string | null> {
    try {
      return await withTimeout(c.clip.stop(), STOP_TIMEOUT_MS);
    } catch (e) {
      this.events.log?.({ error: `stop recording: ${String((e as Error)?.message ?? e)}` });
      return null;
    }
  }

  /** Measures a finished clip's jumps (one at a time), then deletes it. */
  private async measure(c: OpenClip, path: string | null) {
    const job = this.queue.then(async () => {
      let done = 0;
      try {
        for (const j of c.jumps) {
          const { measured, log } = await this.refine(j, c, path);
          const seen = this.seenAt.get(j);
          this.seenAt.delete(j);
          // From the moment the jump was seen live until its height is ready.
          if (seen !== undefined) log.totalMs = Date.now() - seen;
          // Not pending any more when the result arrives (the app clears "Measuring…" at zero).
          this.pending--;
          done++;
          this.events.log?.(log);
          // Read out before the next jump can be seen.
          await this.events.result(measured, true);
        }
      } finally {
        // Even if a result handler throws: nothing stays pending, the clip is deleted.
        this.pending -= c.jumps.length - done;
        for (const j of c.jumps) this.seenAt.delete(j);
        if (path) this.deps.deleteClip(path, c.jumps.length > 0);
      }
    });
    this.queue = job.catch(() => {});
    await job;
  }

  /** Measures one live jump again from its clip; falls back to the live measurement. */
  private async refine(live: Jump, c: OpenClip, path: string | null): Promise<{ measured: Measured; log: Record<string, unknown> }> {
    const size = { width: 0, height: 0 };
    const log: Record<string, unknown> = {
      tOff: live.tOff, hLive: live.hPrimary, framesLive: live.airborneFrames, gLive: live.gImplied, flagsLive: live.flags,
      fpsLive: this.fps,
    };
    // How the phone stood and whether it moved (debugging; logged with every re-measured jump).
    const m = this.deps.motion?.(live.tOff - 1.5, live.tOn + 1);
    if (m) log.motion = { ...motionSummary(m.acc, m.gyro, live.tOff, live.tOn), acc: m.acc, gyro: m.gyro };
    // Exposure decides the motion blur of the feet (debugging; may be missing on Android).
    try {
      const cam = this.deps.camera?.();
      if (cam) log.camera = cam;
    } catch {
      // diagnostics only
    }
    if (path) Object.assign(log, { clip: path.split("/").pop() });
    const fallback = () => {
      const m = this.liveMeasurement(live, size);
      m.approximate = accepted(live);
      return { measured: m, log };
    };
    if (!path) {
      log.error = "no-recording";
      return fallback();
    }
    const t0 = Date.now();
    const seen = this.seenAt.get(live);
    // Waiting for the end of the recording (and for earlier jumps) before measuring could start.
    if (seen !== undefined) log.waitMs = t0 - seen;
    try {
      // The recording's t = 0 on the live clock, corrected by the shift learned from earlier jumps.
      const shift = this.clockShift;
      const start = c.start - shift;
      const pad = this.pad;
      const from = Math.max(0, live.tOff - BEFORE - pad - start);
      const to = live.tOn + AFTER + pad - start;
      // clipStart: the clip's t = 0 on the clock of everything logged (tOff, the pose, the window). Until 2026-11-25
      // the uncorrected start was logged as clipStart, so logged poses seemed to lag their clip by −clockShift.
      Object.assign(log, { clipStart: start, clipStartUncorrected: c.start, window: { from, to }, clockShift: shift, pad });
      const measureClip = async (perFrame: boolean) => {
        const r = await withTimeout(this.deps.analyzeClip(path, from, to, perFrame), this.timeoutMs);
        const frames = r.frames.map((f) => ({ t: f.t + start, lm: f.lm }));
        const found = jumpsIn(frames, r.size);
        return { r, frames, found, jump: closestJump(found, live.tOff) };
      };
      let m = await measureClip(this.perFrame);
      log.perFrame = this.perFrame;
      if (this.perFrame && !(m.jump && accepted(m.jump))) {
        // Nothing measurable frame by frame: once more with tracking (keeps the person through hard frames).
        log.perFrameTry = {
          ms: Date.now() - t0, timing: m.r.timing, withPose: m.frames.filter((f) => f.lm).length,
          ...(m.jump ? { h: m.jump.hPrimary, offset: m.jump.tOff - live.tOff, flags: m.jump.flags } : { error: "no-match" }),
        };
        m = await measureClip(false);
        log.perFrame = false;
      }
      const { r, frames, found, jump } = m;
      log.ms = Date.now() - t0;
      Object.assign(size, r.size);
      const fps = frameRate(frames);
      Object.assign(log, { analysed: frames.length, withPose: frames.filter((f) => f.lm).length, fps, size: r.size, video: r.video, timing: r.timing });
      // For offline analysis (shared separately, see poseReport).
      log.pose = compactPose(frames, r.size);
      if (!jump) {
        log.error = "no-match";
        this.distrustSeed(log);
        log.found = found.map((j) => ({ offset: j.tOff - live.tOff, h: j.hPrimary, frames: j.airborneFrames, flags: j.flags }));
        return fallback();
      }
      Object.assign(log, {
        h: jump.hPrimary, hRise: jump.hRise, hFlight: jump.hFlight, frames: jump.airborneFrames, g: jump.gImplied,
        offset: jump.tOff - live.tOff, flags: jump.flags,
      });
      // Learn from accepted jumps only (offset is what's left after the shift already applied).
      if (!jump.flags.some((f) => REJECT.includes(f))) {
        this.offsets.push(shift + jump.tOff - live.tOff);
        // The remembered shift is one vote among the learned ones until five are learned.
        this.seeded = false;
        this.events.clockShift?.(this.clockShift);
      }
      const measured: Measured = { jump, frames, size: r.size, fps, refined: true, approximate: false, framesFirst: live.airborneFrames };
      if (jump.flags.some((f) => REJECT.includes(f))) {
        log.error = "rejected";
        this.distrustSeed(log);
        // The movement itself can't be measured (moved, left the picture, unsteady points): the live
        // result of the same movement isn't shown instead. A doubtful recording (time base) falls back.
        if (jump.flags.some((f) => MOVEMENT_REJECT.includes(f))) return { measured, log };
        return fallback();
      }
      return { measured, log };
    } catch (e) {
      log.ms = Date.now() - t0;
      log.error = String((e as Error)?.message ?? e);
      return fallback();
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(timer); ok(v); }, (e) => { clearTimeout(timer); fail(e); });
  });
}
