import { findJumps, type Jump, type JumpFlag } from "../../../src/analysis/jumps";
import { slowMotionTimeScale } from "../../../src/media/mp4meta";
import { toSignals } from "../../../src/analysis/signals";
import type { PoseFrame } from "../../../src/analysis/types";
import type { Size } from "./pose";

/** Flags that mean "not a jump we can measure": such movements are listed as ignored. */
export const REJECT: JumpFlag[] = ["not-parabola", "few-frames", "g-implausible", "out-of-view", "inconsistent", "poor-fit"];

/**
 * Rejections about the movement itself rather than the recording: a live measurement of the same
 * movement is no better, so it isn't shown in place of a re-measurement rejected for these.
 */
export const MOVEMENT_REJECT: JumpFlag[] = ["not-parabola", "out-of-view", "inconsistent", "poor-fit"];

export const REJECT_TEXT: Partial<Record<JumpFlag, string>> = {
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
export const NOTE_TEXT: Partial<Record<JumpFlag, string>> = {
  "camera-moved": "The camera moved during this jump; the result may be less accurate.",
};

export const accepted = (j: Jump) => !j.flags.some((f) => REJECT.includes(f));

/**
 * Live jumps worth measuring again: accepted ones, and ones rejected only for what more frames can
 * fix (too few frames, noisy points or edges at the live frame rate).
 */
const REFINABLE: JumpFlag[] = ["few-frames", "inconsistent", "poor-fit"];
export const refinable = (j: Jump) => j.flags.filter((f) => REJECT.includes(f)).every((f) => REFINABLE.includes(f));

/** Seconds analysed again around a live jump: before takeoff (floor level, countermovement) … */
export const BEFORE = 0.8;
/** … and after landing … */
export const AFTER = 0.6;
/** … plus this much on both sides, because the live↔recording time mapping is approximate. */
export const PAD = 0.3;
/** Longer in the air isn't a jump (≈ 1.2 m): not worth re-measuring, it only blocks the app. */
export const MAX_FLIGHT = 1;
/** Allowed takeoff mismatch between the live and the re-measured jump (seconds). */
export const MATCH = 0.5;

/** Frames per second over a list of frames (0 for fewer than two). */
export function frameRate(frames: { t: number }[]): number {
  if (frames.length < 2) return 0;
  const span = frames[frames.length - 1].t - frames[0].t;
  return span > 0 ? (frames.length - 1) / span : 0;
}

export function jumpsIn(frames: PoseFrame[], size: Size): Jump[] {
  return findJumps(toSignals({ ...size, fps: frameRate(frames), frames }));
}

/** The jump whose takeoff is closest to `tOff`, within ±MATCH s; null if none. */
export function closestJump(jumps: Jump[], tOff: number): Jump | null {
  let best: Jump | null = null;
  for (const j of jumps) {
    const d = Math.abs(j.tOff - tOff);
    if (d <= MATCH && (!best || d < Math.abs(best.tOff - tOff))) best = j;
  }
  return best;
}

/**
 * Real seconds per file second. Android slow-motion files store the capture rate in their
 * metadata; their timeline runs at the playback rate. Uses the frame times when known.
 */
export function timeScaleOf(captureFps: number, fileFps: number, frameTimes?: number[]): number {
  if (frameTimes && frameTimes.length > 1) return slowMotionTimeScale(captureFps || null, frameTimes) ?? 1;
  return captureFps > 1.5 * fileFps && fileFps > 0 ? fileFps / captureFps : 1;
}

export interface Window {
  from: number;
  to: number;
}

/** Windows around jumps (real seconds), merged where they overlap. */
export function jumpWindows(jumps: Jump[], before: number, after: number): Window[] {
  const ws = jumps
    .map((j) => ({ from: Math.max(0, j.tOff - before), to: j.tOn + after }))
    .sort((a, b) => a.from - b.from);
  const out: Window[] = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else out.push({ ...w });
  }
  return out;
}

/** Jumps found in several windows (or passes) once: same takeoff within 0.15 s. */
export function uniqueJumps(jumps: Jump[]): Jump[] {
  const out: Jump[] = [];
  for (const j of [...jumps].sort((a, b) => a.tOff - b.tOff)) {
    if (!out.some((k) => Math.abs(k.tOff - j.tOff) < 0.15)) out.push(j);
  }
  return out;
}

export interface Summary {
  count: number;
  best: number;
  average: number;
}

export function summarize(heights: number[]): Summary {
  if (heights.length === 0) return { count: 0, best: 0, average: 0 };
  return {
    count: heights.length,
    best: Math.max(...heights),
    average: heights.reduce((a, b) => a + b, 0) / heights.length,
  };
}

/** Centimetres with one decimal, e.g. "23.4". */
export const cm = (metres: number) => (metres * 100).toFixed(1);
