import type { Landmark, PoseFrame, Signals } from "./types";

/** Test helper: synthetic countermovement jumps rendered as pixel signals. */
export const G = 9.81;

export interface SyntheticJump {
  /** Takeoff time in seconds (start of flight). */
  tTakeoff: number;
  /** True jump height in metres (COM rise after takeoff). */
  height: number;
}

export interface SyntheticOptions {
  fps?: number;
  duration?: number;
  jumps?: SyntheticJump[];
  /** Per-frame Gaussian keypoint noise in metres. */
  noise?: number;
  pxPerMetre?: number;
  stature?: number;
  /** Real-time seconds per video second; 2 = 2× slow motion. */
  slowMotion?: number;
  seed?: number;
}

const HIP_STAND = 1.0; // metres above floor
const DIP = 0.3;
const RISE_AT_TAKEOFF = 0.08;

/** Hip and toe height (metres) at real time t. */
export function bodyAt(t: number, jumps: SyntheticJump[]): { hip: number; toe: number } {
  for (const j of jumps) {
    const v0 = Math.sqrt(2 * G * j.height);
    const tf = (2 * v0) / G;
    const tLow = j.tTakeoff - 0.3, tStart = tLow - 0.5, tLand = j.tTakeoff + tf;
    const yTo = HIP_STAND + RISE_AT_TAKEOFF;
    if (t >= tStart && t < tLow)
      return { hip: quintic(t, tStart, tLow, [HIP_STAND, 0, 0], [HIP_STAND - DIP, 0, 15]), toe: 0 };
    if (t >= tLow && t < j.tTakeoff)
      return { hip: quintic(t, tLow, j.tTakeoff, [HIP_STAND - DIP, 0, 15], [yTo, v0, -G]), toe: 0 };
    if (t >= j.tTakeoff && t < tLand) {
      const x = t - j.tTakeoff;
      const hip = yTo + v0 * x - (G / 2) * x * x;
      return { hip, toe: hip - yTo };
    }
    if (t >= tLand && t < tLand + 0.6) {
      const x = Math.min(t - tLand, 0.3);
      const absorb = yTo - v0 * x + 0.5 * (v0 / 0.3) * x * x - (0.1 * x) / 0.3;
      const recover = t - tLand > 0.3 ? ((t - tLand - 0.3) / 0.3) * (HIP_STAND - (yTo - v0 * 0.15 - 0.1)) : 0;
      return { hip: Math.min(HIP_STAND, absorb + recover), toe: 0 };
    }
  }
  return { hip: HIP_STAND, toe: 0 };
}

export function syntheticSignals(o: SyntheticOptions = {}): Signals {
  const fps = o.fps ?? 30, dur = o.duration ?? 4, noise = o.noise ?? 0;
  const ppm = o.pxPerMetre ?? 300, stature = o.stature ?? 1.75, slow = o.slowMotion ?? 1;
  const jumps = o.jumps ?? [{ tTakeoff: 2, height: 0.3 }];
  const rand = gaussian(o.seed ?? 1);
  const phase = (o.seed ?? 1) % 7 / 7 / fps; // sub-frame sampling offset
  const s: Signals = { t: [], hip: [], toe: [], bodyPx: [] };
  for (let t = phase; t < dur; t += 1 / fps) {
    const b = bodyAt(t / slow, jumps);
    s.t.push(t);
    s.hip.push((b.hip + noise * rand()) * ppm);
    s.toe.push((b.toe + noise * rand()) * ppm);
    s.bodyPx.push(0.92 * stature * ppm);
  }
  return s;
}

function quintic(t: number, t0: number, t1: number, p0: number[], p1: number[]): number {
  const T = t1 - t0, s = (t - t0) / T;
  const [y0, v0, a0] = [p0[0], p0[1] * T, p0[2] * T * T];
  const [y1, v1, a1] = [p1[0], p1[1] * T, p1[2] * T * T];
  const s3 = s ** 3, s4 = s ** 4, s5 = s ** 5;
  return (1 - 10 * s3 + 15 * s4 - 6 * s5) * y0 + (s - 6 * s3 + 8 * s4 - 3 * s5) * v0 +
    (0.5 * s * s - 1.5 * s3 + 1.5 * s4 - 0.5 * s5) * a0 + (10 * s3 - 15 * s4 + 6 * s5) * y1 +
    (-4 * s3 + 7 * s4 - 3 * s5) * v1 + (0.5 * s3 - s4 + 0.5 * s5) * a1;
}

function gaussian(seed: number): () => number {
  let x = seed >>> 0 || 1;
  const uni = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) + 1) / 4294967297;
  return () => Math.sqrt(-2 * Math.log(uni())) * Math.cos(2 * Math.PI * uni());
}

/** Synthetic jumps as MediaPipe-style landmark frames (for tracker tests). */
export function syntheticFrames(o: SyntheticOptions = {}): { width: number; height: number; frames: PoseFrame[] } {
  const s = syntheticSignals(o);
  const width = 720, height = 1280, floorPx = 100; // floor 100 px above the image bottom
  const y = (upPx: number) => (height - (upPx + floorPx)) / height;
  const frames = s.t.map((t, i) => {
    const lm: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.9] as Landmark);
    const set = (idx: number[], up: number) => idx.forEach((k) => (lm[k] = [0.5, y(up), 0, 0.9]));
    set([23, 24], s.hip[i]);
    set([29, 30, 31, 32], s.toe[i]);
    set([0], s.toe[i] + s.bodyPx[i]);
    return { t, lm };
  });
  return { width, height, frames };
}
