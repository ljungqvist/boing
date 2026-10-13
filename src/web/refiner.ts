import { findJumps, type Jump, type JumpFlag } from "../analysis/jumps";
import { toSignals } from "../analysis/signals";
import type { PoseFrame } from "../analysis/types";
import { processVideo } from "./file";
import type { Pose } from "./pose";
import type { Piece } from "./recorder";

/** Live seconds re-analysed around a jump: before takeoff (floor level, countermovement) … */
export const BEFORE = 0.8;
/** … and after landing. Together with the margins this must stay below piece − stagger. */
export const AFTER = 0.6;
/** Extra seconds analysed on both sides, and the allowed takeoff mismatch: the live↔piece time mapping is approximate. */
const SLACK = 0.5;

export interface Refined {
  /** The jump on the piece's own timeline (seconds from the piece's start). */
  jump: Jump;
  frames: PoseFrame[];
  size: { width: number; height: number };
  /** Recorded frame rate in the analysed stretch. */
  fps: number;
  ms: number;
  /** Refined takeoff (mapped to live time) minus live takeoff, seconds. */
  offset: number;
}
export type RefineResult = Refined | { error: string; ms: number; flags?: JumpFlag[] };

export const REJECT: JumpFlag[] = ["not-parabola", "few-frames", "g-implausible"];

/**
 * Re-analyses a live jump from a recorded piece, using every recorded frame.
 * Jobs run one at a time, on a hidden video element and their own pose instance.
 */
export class Refiner {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly getPose: () => Promise<Pose>,
    private readonly video: HTMLVideoElement,
    private readonly timeoutMs = 15_000,
  ) {}

  refine(live: Jump, piece: Piece, signal?: AbortSignal): Promise<RefineResult> {
    const job = this.queue.then(() => this.run(live, piece, signal));
    this.queue = job.catch(() => {});
    return job;
  }

  private async run(live: Jump, piece: Piece, outer?: AbortSignal): Promise<RefineResult> {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    if (outer?.aborted) return { error: "cancelled", ms: 0 };
    if (!piece.blob) return { error: "no-recording", ms: 0 };
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    outer?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    const frames: PoseFrame[] = [];
    try {
      const pose = await this.getPose();
      pose.resetClock();
      const from = live.tOff - BEFORE - SLACK - piece.start;
      const to = live.tOn + AFTER + SLACK - piece.start;
      await processVideo(piece.blob, this.video, (t) => {
        frames.push({ t, lm: pose.detect(this.video, t * 1000) });
      }, () => {}, abort.signal, { from, to });
      const size = { width: this.video.videoWidth, height: this.video.videoHeight };
      if (frames.length < 10) return { error: "no-frames", ms: ms() };
      const fps = (frames.length - 1) / (frames[frames.length - 1].t - frames[0].t);
      const target = live.tOff - piece.start;
      const near = findJumps(toSignals({ ...size, fps, frames }))
        .filter((j) => Math.abs(j.tOff - target) <= SLACK)
        .sort((a, b) => Math.abs(a.tOff - target) - Math.abs(b.tOff - target));
      const jump = near[0];
      if (!jump) return { error: "no-match", ms: ms() };
      if (jump.flags.some((f) => REJECT.includes(f))) return { error: "rejected", ms: ms(), flags: jump.flags };
      return { jump, frames, size, fps, ms: ms(), offset: jump.tOff - target };
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "AbortError") return { error: outer?.aborted ? "cancelled" : "timeout", ms: ms() };
      console.warn("refinement failed", e);
      return { error: String((e as Error)?.message ?? e), ms: ms() };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
      this.video.removeAttribute("src");
      this.video.load(); // release the decoder
    }
  }
}
