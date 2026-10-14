import type { Jump } from "../../../src/analysis/jumps";
import { JumpTracker } from "../../../src/analysis/tracker";
import type { PoseFrame } from "../../../src/analysis/types";
import { accepted, AFTER, BEFORE, closestJump, frameRate, jumpsIn, PAD, REJECT, refinable } from "./measure";
import type { Size } from "./pose";
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
  /** Pose of every recorded frame between `from` and `to` (seconds from the clip's start). */
  analyzeClip(path: string, from: number, to: number): Promise<{ frames: PoseFrame[]; size: Size }>;
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
      this.events.log?.({ tOff: j.tOff, hLive: j.hPrimary, framesLive: j.airborneFrames, refined: false, reason: c ? "not-refinable-or-before-clip" : "no-clip" });
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
      for (const j of c.jumps) {
        await this.refine(j, c, path);
        this.pending--;
      }
      if (path) this.deps.deleteClip(path);
    });
    this.queue = job.catch(() => {});
    await job;
  }

  private async refine(live: Jump, c: OpenClip, path: string | null) {
    const size = { width: 0, height: 0 };
    const log: Record<string, unknown> = { tOff: live.tOff, hLive: live.hPrimary, framesLive: live.airborneFrames, flagsLive: live.flags };
    const fallback = () => {
      const m = this.liveMeasurement(live, size);
      m.approximate = accepted(live);
      this.events.log?.(log);
      this.events.result(m);
    };
    if (!path) {
      log.error = "no-recording";
      return fallback();
    }
    const t0 = Date.now();
    try {
      const from = Math.max(0, live.tOff - BEFORE - PAD - c.start);
      const to = live.tOn + AFTER + PAD - c.start;
      const r = await withTimeout(this.deps.analyzeClip(path, from, to), this.timeoutMs);
      log.ms = Date.now() - t0;
      Object.assign(size, r.size);
      const frames = r.frames.map((f) => ({ t: f.t + c.start, lm: f.lm }));
      const fps = frameRate(frames);
      Object.assign(log, { analysed: frames.length, fps });
      const jump = closestJump(jumpsIn(frames, r.size), live.tOff);
      if (!jump) {
        log.error = "no-match";
        return fallback();
      }
      Object.assign(log, { h: jump.hPrimary, hFlight: jump.hFlight, frames: jump.airborneFrames, offset: jump.tOff - live.tOff, flags: jump.flags });
      if (jump.flags.some((f) => REJECT.includes(f))) {
        log.error = "rejected";
        return fallback();
      }
      this.events.log?.(log);
      this.events.result({ jump, frames, size: r.size, fps, refined: true, approximate: false, framesFirst: live.airborneFrames });
    } catch (e) {
      log.ms = Date.now() - t0;
      log.error = String((e as Error)?.message ?? e);
      fallback();
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(timer); ok(v); }, (e) => { clearTimeout(timer); fail(e); });
  });
}
