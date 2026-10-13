import { findJumps, type Jump } from "./jumps";
import { toSignals } from "./signals";
import type { PoseFrame } from "./types";

export interface TrackerOptions {
  /** Seconds of history analysed on each pass. */
  windowSeconds?: number;
  /** A jump is reported once its landing is this many seconds in the past. */
  settleSeconds?: number;
  /** Minimum video time between analysis passes. */
  intervalSeconds?: number;
  stature?: number;
}

/** Streams pose frames in, reports each finished jump once. */
export class JumpTracker {
  private frames: PoseFrame[] = [];
  private reported: number[] = []; // takeoff times
  private lastPass = -Infinity;
  private readonly window: number;
  private readonly settle: number;
  private readonly interval: number;
  private readonly stature?: number;

  constructor(opts: TrackerOptions = {}) {
    this.window = opts.windowSeconds ?? 8;
    this.settle = opts.settleSeconds ?? 0.8;
    this.interval = opts.intervalSeconds ?? 0.25;
    this.stature = opts.stature;
  }

  reset(): void {
    this.frames = [];
    this.reported = [];
    this.lastPass = -Infinity;
  }

  /** Add a frame (t in seconds); returns jumps that finished since the last call. */
  push(frame: PoseFrame, size: { width: number; height: number }): Jump[] {
    const last = this.frames[this.frames.length - 1];
    if (last && frame.t <= last.t) this.reset();
    this.frames.push(frame);
    while (this.frames[0].t < frame.t - this.window) this.frames.shift();

    if (frame.t - this.lastPass < this.interval) return [];
    this.lastPass = frame.t;

    const signals = toSignals({ ...size, fps: 0, frames: this.frames });
    const fresh: Jump[] = [];
    for (const j of findJumps(signals, { stature: this.stature })) {
      if (j.tOn > frame.t - this.settle) continue;
      if (this.reported.some((t) => Math.abs(t - j.tOff) < 0.15)) continue;
      this.reported.push(j.tOff);
      fresh.push(j);
    }
    this.reported = this.reported.filter((t) => t > frame.t - this.window - 1);
    return fresh;
  }
}
