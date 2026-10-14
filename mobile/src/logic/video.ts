import type { Jump } from "../../../src/analysis/jumps";
import type { PoseFrame } from "../../../src/analysis/types";
import { closestJump, frameRate, jumpsIn, jumpWindows, timeScaleOf, uniqueJumps } from "./measure";
import type { Size } from "./pose";

/** A measured jump with the frames it was measured from (for the detail plot). */
export interface Measured {
  jump: Jump;
  frames: PoseFrame[];
  size: Size;
  /** Frame rate of the frames the jump was measured from (real time). */
  fps: number;
  /** Measured from every recorded frame. */
  refined: boolean;
  /** Only a lighter measurement (fewer frames) was possible: shown with "≈". */
  approximate: boolean;
  /** Frames in the air in the live or first pass, when there was one. */
  framesFirst?: number;
}

/** Pose of the frames of a video file between `from` and `to` (file seconds). */
export type Analyze = (
  opts: { from: number; to: number; minInterval: number },
  onProgress: (fraction: number) => void,
) => Promise<{ frames: PoseFrame[]; size: Size }>;

export interface FileFacts {
  /** Seconds on the file's timeline. */
  duration: number;
  /** Average frames per second of the file's timeline. */
  fps: number;
  /** Frame rate from the shortest frame gaps (variable-frame-rate files average lower). */
  peakFps?: number;
  /** Capture rate from the metadata (Android slow motion), or 0. */
  captureFps: number;
}

/** Real-time frame spacing of the first pass over a whole file. */
export const FIRST_PASS_INTERVAL = 1 / 30;
/** Real seconds analysed at every frame before takeoff and after landing. */
const BEFORE = 1.2;
const AFTER = 1.0;

/**
 * Measures every jump in a video file. Files above ~35 fps (real time) get two passes: a first
 * one at about 30 fps over the whole file to find the jumps, then every frame around each jump.
 */
export async function measureVideo(
  file: FileFacts,
  analyze: Analyze,
  onProgress: (fraction: number) => void = () => {},
): Promise<{ jumps: Measured[]; fps: number; timeScale: number; captureFps: number }> {
  // Slow motion is judged from the shortest frame gaps, like the web app: a variable-frame-rate
  // recording reports its maximum rate as capture rate but averages lower.
  const fileFps = file.peakFps ?? file.fps;
  const scale = timeScaleOf(file.captureFps, fileFps);
  const realFps = fileFps / scale;
  const twoPass = realFps > 35;
  const first = await analyze(
    { from: 0, to: file.duration, minInterval: twoPass ? FIRST_PASS_INTERVAL / scale * 0.98 : 0 },
    (p) => onProgress(twoPass ? p / 2 : p),
  );
  // One pass: the frame times show whether the file is slow motion (Android metadata alone can't).
  const scale1 = twoPass ? scale : timeScaleOf(file.captureFps, fileFps, first.frames.map((f) => f.t));
  const frames1 = first.frames.map((f) => ({ t: f.t * scale1, lm: f.lm }));
  const fps1 = frameRate(frames1);
  const found = jumpsIn(frames1, first.size);
  const measured = (jump: Jump, frames: PoseFrame[], size: Size, fps: number, refined: boolean): Measured => ({
    jump, frames, size, fps, refined, approximate: false,
  });
  if (!twoPass) {
    return { jumps: found.map((j) => measured(j, frames1, first.size, fps1, true)), fps: fps1, timeScale: scale1, captureFps: file.captureFps };
  }

  const windows = jumpWindows(found, BEFORE, AFTER);
  const total = windows.reduce((s, w) => s + w.to - w.from, 0) || 1;
  let done = 0;
  const dense: Measured[] = [];
  let fps = 0;
  for (const w of windows) {
    const r = await analyze({ from: w.from / scale, to: w.to / scale, minInterval: 0 }, (p) =>
      onProgress(0.5 + (0.5 * (done + p * (w.to - w.from))) / total));
    done += w.to - w.from;
    // The whole file decides about slow motion: one window of a variable-frame-rate file can run
    // below its peak rate and look slowed down.
    const s = scale;
    const frames = r.frames.map((f) => ({ t: f.t * s, lm: f.lm }));
    const wFps = frameRate(frames);
    fps = Math.max(fps, wFps);
    for (const j of jumpsIn(frames, r.size)) dense.push(measured(j, frames, r.size, wFps, true));
  }
  const unique = uniqueJumps(dense.map((m) => m.jump));
  const out = dense.filter((m) => unique.includes(m.jump));
  for (const m of out) m.framesFirst = closestJump(found, m.jump.tOff)?.airborneFrames;
  // Jumps the dense pass didn't confirm keep their first-pass measurement, marked approximate.
  for (const j of found) {
    if (!closestJump(unique, j.tOff)) out.push({ ...measured(j, frames1, first.size, fps1, false), approximate: true });
  }
  out.sort((a, b) => a.jump.tOff - b.jump.tOff);
  onProgress(1);
  return { jumps: out, fps: fps || fps1, timeScale: scale, captureFps: file.captureFps };
}
