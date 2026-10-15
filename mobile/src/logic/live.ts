import type { Jump } from "../../../src/analysis/jumps";
import { JumpTracker } from "../../../src/analysis/tracker";
import type { PoseFrame } from "../../../src/analysis/types";
import { accepted, AFTER, BEFORE, closestJump, frameRate, jumpsIn, MOVEMENT_REJECT, PAD, REJECT, refinable } from "./measure";
import type { Size } from "./pose";
import { compactPose } from "./diagnostics";
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
   * Pose of every recorded frame between `from` and `to` (seconds from the clip's start), and
   * facts about the recorded file (size, rotation, frame rate) for the diagnostics.
   */
  analyzeClip(path: string, from: number, to: number): Promise<{ frames: PoseFrame[]; size: Size; video?: Record<string, unknown> }>;
  deleteClip(path: string): void;
}

export interface LiveEvents {
  status(s: Status): void;
  /** A jump was seen; its height follows. */
  measuring(): void;
  /** A finished measurement (also for rejected movements: check `accepted(m.jump)`). */
  result(m: Measured): void;
  /** Diagnostics for each live jump (refinement details). */
  log?(entry: Record<string, unknown>): void;
}

export interface LiveOptions {
  /** Record clips and measure each jump again from every recorded frame. */
  record?: boolean;
  /** Seconds after which a clip without jumps is replaced by a new one (keeps files small). */
  rotateSeconds?: number;
  /** Give up re-measuring a jump after this many milliseconds. */
  timeoutMs?: number;
}

/** Live pose history kept for status, fallback plots and diagnostics (seconds). */
const HISTORY = 20;

interface OpenClip {
  clip: Clip;
  /** Live time (frame clock) when recording had started: the clip's t = 0, approximately. */
  start: number;
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
  private clip: OpenClip | null = null;
  private starting = false;
  /** After a failed recording start, wait until this frame time before trying again. */
  private retryAt = -Infinity;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly record: boolean;
  private readonly rotateSeconds: number;
  private readonly timeoutMs: number;
  /** Jumps waiting for their re-measured height. */
  pending = 0;

  constructor(private readonly deps: LiveDeps, private readonly events: LiveEvents, opts: LiveOptions = {}) {
    this.record = opts.record ?? true;
    this.rotateSeconds = opts.rotateSeconds ?? 15;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Live analysis rate (frames per second over the last second). */
  get fps(): number {
    return this.fpsWindow.length;
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
    if (Number.isNaN(this.firstT)) this.firstT = t;
    this.lastT = t;
    this.history.push(frame);
    while (this.history[0].t < t - HISTORY) this.history.shift();
    this.fpsWindow.push(t);
    this.fpsWindow = this.fpsWindow.filter((x) => x > t - 1);

    const status = liveStatus(this.history, frame.lm, this.fps, t - this.firstT > 2);
    if (status.tone === "air") this.lastAir = t;
    this.events.status(status);

    for (const j of this.tracker.push(frame, size)) this.onJump(j, size);

    if (!this.record) return;
    if (!this.clip) {
      if (!this.starting && t >= this.retryAt) void this.startClip();
      return;
    }
    const c = this.clip;
    const lastEnd = Math.max(...c.jumps.map((j) => j.tOn + AFTER + PAD));
    // A clip with jumps ends once it covers them; one without is replaced now and then.
    if (c.jumps.length > 0 ? t >= lastEnd : t - c.start > this.rotateSeconds && t - this.lastAir > 2) void this.rotate();
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
    if (!c || !refinable(j) || j.tOff - 0.5 < c.start) {
      this.events.log?.({
        tOff: j.tOff, hLive: j.hPrimary, framesLive: j.airborneFrames, gLive: j.gImplied, flagsLive: j.flags,
        refined: false, reason: c ? "not-refinable-or-before-clip" : "no-clip",
      });
      this.events.result(live);
      return;
    }
    this.pending++;
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
        this.deps.deleteClip(await clip.stop());
        return;
      }
      this.clip = { clip, start: this.lastT, jumps: [] };
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
   * jump's landing or during a quiet stretch.
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
    if (!this.stopped) await this.startClip();
    await this.measure(old, path);
  }

  private async stopClip(c: OpenClip): Promise<string | null> {
    try {
      return await c.clip.stop();
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
          // Not pending any more when the result arrives (the app clears "Measuring…" at zero).
          this.pending--;
          done++;
          this.events.log?.(log);
          this.events.result(measured);
        }
      } finally {
        // Even if a result handler throws: nothing stays pending, the clip is deleted.
        this.pending -= c.jumps.length - done;
        if (path) this.deps.deleteClip(path);
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
    try {
      const from = Math.max(0, live.tOff - BEFORE - PAD - c.start);
      const to = live.tOn + AFTER + PAD - c.start;
      log.window = { from, to };
      const r = await withTimeout(this.deps.analyzeClip(path, from, to), this.timeoutMs);
      log.ms = Date.now() - t0;
      Object.assign(size, r.size);
      const frames = r.frames.map((f) => ({ t: f.t + c.start, lm: f.lm }));
      const fps = frameRate(frames);
      Object.assign(log, { analysed: frames.length, withPose: frames.filter((f) => f.lm).length, fps, size: r.size, video: r.video });
      // For offline analysis (shared separately, see poseReport).
      log.pose = compactPose(frames, r.size);
      const found = jumpsIn(frames, r.size);
      const jump = closestJump(found, live.tOff);
      if (!jump) {
        log.error = "no-match";
        log.found = found.map((j) => ({ offset: j.tOff - live.tOff, h: j.hPrimary, frames: j.airborneFrames, flags: j.flags }));
        return fallback();
      }
      Object.assign(log, {
        h: jump.hPrimary, hFlight: jump.hFlight, frames: jump.airborneFrames, g: jump.gImplied,
        offset: jump.tOff - live.tOff, flags: jump.flags,
      });
      const measured: Measured = { jump, frames, size: r.size, fps, refined: true, approximate: false, framesFirst: live.airborneFrames };
      if (jump.flags.some((f) => REJECT.includes(f))) {
        log.error = "rejected";
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
