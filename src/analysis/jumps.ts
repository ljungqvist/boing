import { fitQuadratic, quadraticRoots, type Quadratic } from "./fit";
import type { Signals } from "./types";

export interface JumpOptions {
  /** Jumper's body height in metres; only used for the implied-g check. */
  stature?: number;
  g?: number;
}

export type JumpFlag =
  | "few-frames"      // too few airborne frames for a reliable fit
  | "g-implausible"   // hip curvature doesn't match gravity: slow motion, arm swing, wrong scale
  | "not-parabola"    // hip isn't decelerating during "flight"
  | "poor-fit"        // large residuals: tucked legs, bad keypoints
  | "disagree"        // takeoff→apex and flight-time heights differ: bent-knee landing?
  | "camera-moved";   // floor line differs before and after the jump

export interface Jump {
  tOff: number;
  tOn: number;
  tApex: number;
  /** Height from takeoff to apex, g/2·(tApex − tOff)², metres. */
  hPrimary: number;
  /** Height from flight time, g·(tOn − tOff)²/8, metres. */
  hFlight: number;
  airborneFrames: number;
  gImplied: number;
  hipRmsRel: number;
  toeRmsRel: number;
  floorShiftRel: number;
  flags: JumpFlag[];
  /** Details for plotting/debugging. */
  debug: { i0: number; i1: number; floor: number; bodyPx: number; hipFit: Quadratic; toeFit: Quadratic };
}

const NOSE_TO_HEEL_PER_STATURE = 0.92;

export function findJumps(s: Signals, opts: JumpOptions = {}): Jump[] {
  const g = opts.g ?? 9.81;
  const stature = opts.stature ?? 1.75;
  const n = s.t.length;
  const bodyAll = median(s.bodyPx.filter(Number.isFinite));
  if (!Number.isFinite(bodyAll)) return [];

  const sigma = noiseSigma(s.toe);
  const thr = Math.max(4 * sigma, 0.02 * bodyAll);
  const floor = rollingPercentile(s.t, s.toe, 1.0, 0.25);

  // Airborne runs; a missing frame keeps the previous state.
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const v = i < n ? s.toe[i] - floor[i] : -Infinity;
    const up = Number.isNaN(v) ? start >= 0 : v > thr;
    if (up && start < 0) start = i;
    if (!up && start >= 0) {
      let end = i - 1;
      while (end > start && !Number.isFinite(s.toe[end])) end--;
      runs.push([start, end]);
      start = -1;
    }
  }

  const jumps: Jump[] = [];
  for (const [i0, i1] of runs) {
    const dur = s.t[i1] - s.t[i0];
    if (dur < 0.1 || dur > 1.2) continue;
    const idx = range(i0, i1).filter((i) => Number.isFinite(s.toe[i]) && Number.isFinite(s.hip[i]));
    if (idx.length < 5) continue;

    const t0 = s.t[i0], t1 = s.t[i1];
    const floorBefore = windowMedian(s.t, s.toe, t0 - 0.6, t0 - 0.1) ?? floor[i0];
    const floorAfter = windowMedian(s.t, s.toe, t1 + 0.1, t1 + 0.6) ?? floorBefore;
    const bodyPx = windowMedian(s.t, s.bodyPx, t0 - 1.0, t0 - 0.1) ?? bodyAll;

    const tt = idx.map((i) => s.t[i]);
    const toeFit = fitQuadratic(tt, idx.map((i) => s.toe[i]));
    const hipFit = fitQuadratic(tt, idx.map((i) => s.hip[i]));
    const [tOff, tOn] = quadraticRoots(toeFit, floorBefore) ?? [t0, t1];
    const tApex = hipFit.vertex;

    const pxPerMetre = bodyPx / (NOSE_TO_HEEL_PER_STATURE * stature);
    const gImplied = (-2 * hipFit.a) / pxPerMetre;
    const hPrimary = (g / 2) * (tApex - tOff) ** 2;
    const hFlight = (g * (tOn - tOff) ** 2) / 8;

    const j: Jump = {
      tOff, tOn, tApex, hPrimary, hFlight,
      airborneFrames: idx.length,
      gImplied,
      hipRmsRel: hipFit.rms / bodyPx,
      toeRmsRel: toeFit.rms / bodyPx,
      floorShiftRel: Math.abs(floorAfter - floorBefore) / bodyPx,
      flags: [],
      debug: { i0, i1, floor: floorBefore, bodyPx, hipFit, toeFit },
    };
    if (j.airborneFrames < 8) j.flags.push("few-frames");
    if (hipFit.a >= 0) j.flags.push("not-parabola");
    else if (gImplied < 6.5 || gImplied > 13) j.flags.push("g-implausible");
    if (Math.max(j.hipRmsRel, j.toeRmsRel) > 0.015) j.flags.push("poor-fit");
    if (Math.abs(hPrimary - hFlight) > 0.15 * hFlight) j.flags.push("disagree");
    if (j.floorShiftRel > 0.02) j.flags.push("camera-moved");
    jumps.push(j);
  }
  return jumps;
}

/** Robust per-frame noise estimate from first differences. */
function noiseSigma(y: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < y.length; i++) if (Number.isFinite(y[i]) && Number.isFinite(y[i - 1])) d.push(y[i] - y[i - 1]);
  if (d.length === 0) return 0;
  const m = median(d);
  return (1.4826 * median(d.map((x) => Math.abs(x - m)))) / Math.SQRT2;
}

/** p-quantile of y within ±halfWidth seconds of each sample. */
function rollingPercentile(t: number[], y: number[], halfWidth: number, p: number): number[] {
  const out: number[] = [];
  let lo = 0, hi = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[lo] < t[i] - halfWidth) lo++;
    while (hi < t.length && t[hi] <= t[i] + halfWidth) hi++;
    const w = y.slice(lo, hi).filter(Number.isFinite).sort((a, b) => a - b);
    out.push(w.length ? w[Math.floor(p * (w.length - 1))] : NaN);
  }
  return out;
}

function windowMedian(t: number[], y: number[], from: number, to: number): number | null {
  const w: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to && Number.isFinite(y[i])) w.push(y[i]);
  return w.length >= 3 ? median(w) : null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
