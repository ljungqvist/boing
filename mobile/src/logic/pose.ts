import type { Landmark, PoseFrame } from "../../../src/analysis/types";

/** MediaPipe pose landmarks per frame, and values per landmark (x, y, z, visibility). */
export const LANDMARKS = 33;
const VALUES = 4;
const SIZE = LANDMARKS * VALUES;

/** Upright frame size in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** `PoseDetector.detect` result ([t, width, height, ...33×4]) → frame + size. */
export function fromDetect(a: number[]): { frame: PoseFrame; size: Size } {
  const lm = a.length >= 3 + SIZE ? toLandmarks(a, 3) : null;
  return { frame: { t: a[0], lm }, size: { width: a[1], height: a[2] } };
}

/** Output of `analyzeVideo`, flat. */
export interface AnalyzedFrames {
  times: number[];
  /** Truthy where a person was found. */
  found: (boolean | number)[];
  landmarks: number[];
}

/**
 * Analysed video frames → pose frames. `timeScale` converts file seconds to real seconds
 * (slow motion), `offset` (real seconds) is added afterwards.
 */
export function toFrames(r: AnalyzedFrames, timeScale = 1, offset = 0): PoseFrame[] {
  return r.times.map((t, k) => ({
    t: t * timeScale + offset,
    lm: r.found[k] ? toLandmarks(r.landmarks, k * SIZE) : null,
  }));
}

function toLandmarks(a: number[], start: number): Landmark[] {
  const lm: Landmark[] = [];
  for (let i = 0; i < LANDMARKS; i++) {
    const o = start + i * VALUES;
    lm.push([a[o], a[o + 1], a[o + 2], a[o + 3]]);
  }
  return lm;
}
