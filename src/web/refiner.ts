import { findJumps, type Jump, type JumpFlag } from "../analysis/jumps";
import { toSignals } from "../analysis/signals";
import type { PoseFrame } from "../analysis/types";
import { decodeWebM } from "./decode";
import { processVideo } from "./file";
import type { Pose } from "./pose";
import type { Piece } from "./recorder";

/** Live seconds re-analysed around a jump: before takeoff (floor level, countermovement) … */
export const BEFORE = 0.8;
/** … and after landing. Together with the margins this must stay below piece − stagger. */
export const AFTER = 0.6;
/** The live↔piece time mapping is approximate (measured: within ~50 ms): extra seconds analysed on both sides … */
const PAD = 0.25;
/** … and the allowed takeoff mismatch between the live and the refined jump. */
const MATCH = 0.5;

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
  /** How the piece was decoded: WebCodecs (every frame) or stepping a hidden video (fallback). */
  decoder: "webcodecs" | "video";
  /** Pose model used. */
  model: string;
}
export type RefineResult = Refined | { error: string; ms: number; flags?: JumpFlag[]; rejected?: Jump };

export const REJECT: JumpFlag[] = ["not-parabola", "few-frames", "g-implausible", "out-of-view", "inconsistent", "poor-fit"];
/** Rejections about the movement itself: the live result of the same movement isn't shown instead. */
export const MOVEMENT_REJECT: JumpFlag[] = ["not-parabola", "out-of-view", "inconsistent", "poor-fit"];

/**
 * Re-analyses a live jump from a recorded piece, using every recorded frame.
 * Jobs run one at a time. They borrow the live pose instance: two MediaPipe instances
 * running side by side stalled the camera (Chrome), so live analysis pauses meanwhile
 * (`onBusy`), and the pose clock is handed back afterwards.
 */
export class Refiner {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly getPose: () => Promise<Pose>,
    private readonly video: HTMLVideoElement,
    private readonly timeoutMs = 15_000,
    /** Called when a job starts and ends (e.g. to pause the live analysis meanwhile). */
    private readonly onBusy: (busy: boolean) => void = () => {},
  ) {}

  refine(live: Jump, piece: Piece, signal?: AbortSignal): Promise<RefineResult> {
    const job = this.queue.then(() => this.run(live, piece, signal));
    this.queue = job.catch(() => {});
    return job;
  }

  private async run(live: Jump, piece: Piece, outer?: AbortSignal): Promise<RefineResult> {
    this.onBusy(true);
    try {
      return await this.job(live, piece, outer);
    } finally {
      this.onBusy(false);
    }
  }

  private async job(live: Jump, piece: Piece, outer?: AbortSignal): Promise<RefineResult> {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    if (outer?.aborted) return { error: "cancelled", ms: 0 };
    if (!piece.blob) return { error: "no-recording", ms: 0 };
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    outer?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    const frames: PoseFrame[] = [];
    let pose: Pose | null = null;
    try {
      const p = (pose = await this.getPose());
      p.resetClock();
      const from = live.tOff - BEFORE - PAD - piece.start;
      const to = live.tOn + AFTER + PAD - piece.start;
      let decoder: Refined["decoder"] = "webcodecs";
      let size = { width: 0, height: 0 };
      const decoded = await decodeWebM(piece.blob, (frame, t) => {
        frames.push({ t, lm: p.detect(frame, t * 1000) });
      }, abort.signal, { from, to });
      if (decoded) size = { width: decoded.width, height: decoded.height };
      else {
        decoder = "video";
        await processVideo(piece.blob, this.video, (t) => {
          frames.push({ t, lm: p.detect(this.video, t * 1000) });
        }, () => {}, abort.signal, { from, to });
        size = { width: this.video.videoWidth, height: this.video.videoHeight };
      }
      if (frames.length < 10) return { error: "no-frames", ms: ms() };
      const fps = (frames.length - 1) / (frames[frames.length - 1].t - frames[0].t);
      const target = live.tOff - piece.start;
      const near = findJumps(toSignals({ ...size, fps, frames }))
        .filter((j) => Math.abs(j.tOff - target) <= MATCH)
        .sort((a, b) => Math.abs(a.tOff - target) - Math.abs(b.tOff - target));
      const jump = near[0];
      if (!jump) return { error: "no-match", ms: ms() };
      if (jump.flags.some((f) => REJECT.includes(f))) return { error: "rejected", ms: ms(), flags: jump.flags, rejected: jump };
      return { jump, frames, size, fps, ms: ms(), offset: jump.tOff - target, decoder, model: p.kind };
    } catch (e) {
      if (outer?.aborted) return { error: "cancelled", ms: ms() };
      if (abort.signal.aborted) return { error: "timeout", ms: ms() };
      console.warn("refinement failed", e);
      return { error: String((e as Error)?.message ?? e), ms: ms() };
    } finally {
      pose?.resetClock(); // the live timeline continues next
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
      if (this.video.src) {
        this.video.removeAttribute("src");
        this.video.load(); // release the decoder
      }
    }
  }
}
