import { fitQuadratic, quadraticRoots, type Quadratic } from "./fit";
import type { Signals } from "./types";

export interface JumpOptions {
  /** Jumper's body height in metres; only used for the implied-g check. */
  stature?: number;
  g?: number;
}

export type JumpFlag =
  | "few-frames"      // too few airborne frames for a reliable fit
  | "g-implausible"   // hip curvature far from gravity: wrong time base (slow motion) or not a jump
  | "not-parabola"    // hip isn't decelerating during "flight"
  | "poor-fit"        // large residuals: tucked legs, bad keypoints
  | "disagree"        // takeoff→apex and flight-time heights differ: bent-knee landing?
  | "camera-moved"    // floor line differs before and after the jump
  | "out-of-view"     // hips or feet left the picture, or the person was lost in the flight: too close?
  | "inconsistent";   // takeoff→apex and flight-time heights can't be one flight (or the apex comes too late)

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
  /** Fraction of the airborne run without hip or toe points. */
  lostRel: number;
  /** Furthest the hips or feet lay outside the picture around the jump (fraction of the frame). */
  outsideRel: number;
  flags: JumpFlag[];
  /** Details for plotting/debugging. */
  debug: { i0: number; i1: number; floor: number; bodyPx: number; hipFit: Quadratic; toeFit: Quadratic };
}

const NOSE_TO_HEEL_PER_STATURE = 0.92;
/** Hips or feet this far outside the picture (fraction of the frame) make a jump unmeasurable. */
const MAX_OUTSIDE = 0.03;
/** Most of the airborne run that may lack hip or toe points. */
const MAX_LOST = 0.2;
/** Takeoff→apex and flight-time heights further apart than this factor aren't one flight. */
const MAX_HEIGHT_RATIO = 2;
/**
 * Takeoff→apex may exceed the flight-time height only by measurement noise: more would mean landing
 * higher than the takeoff, which a jump can't do (the body is never more stretched than at takeoff).
 * Moving towards a floor-level camera in the air shifts the hips' apex late and reads 30–55 cm for a
 * 16 cm jump; normal jumps stay below ≈ 1.15 at 30 fps (docs/evaluation/2026-10-15-accuracy-review.md).
 */
const MAX_RISE_OVER_FLIGHT = 1.2;

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
    // Upright size: the countermovement crouch and the landing shrink the body.
    const bodyPx = windowQuantile(s.t, s.bodyPx, t0 - 3, t1 + 3, 0.9) ?? bodyAll;

    // Fit only the flight; with toe creep trimmed, the edges are at the toe level where the
    // fast rise starts and the fast fall ends.
    const fl = trimCreep(s, idx, Math.max(3 * sigma, 0.01 * bodyPx), floorBefore, thr, bodyPx);
    const level = (c: number | null) => (c !== null ? s.toe[c] : floorBefore);
    const tt = fl.frames.map((i) => s.t[i]);
    const toeFit = fitQuadratic(tt, fl.frames.map((i) => s.toe[i]));
    const hipFit = fitQuadratic(tt, fl.frames.map((i) => s.hip[i]));
    const tOff = quadraticRoots(toeFit, level(fl.before))?.[0] ?? t0;
    const tOn = quadraticRoots(toeFit, level(fl.after))?.[1] ?? t1;
    const tApex = hipFit.vertex;

    const pxPerMetre = bodyPx / (NOSE_TO_HEEL_PER_STATURE * stature);
    const gImplied = (-2 * hipFit.a) / pxPerMetre;
    const hPrimary = (g / 2) * (tApex - tOff) ** 2;
    const hFlight = (g * (tOn - tOff) ** 2) / 8;

    const j: Jump = {
      tOff, tOn, tApex, hPrimary, hFlight,
      airborneFrames: fl.frames.length,
      gImplied,
      hipRmsRel: hipFit.rms / bodyPx,
      toeRmsRel: toeFit.rms / bodyPx,
      floorShiftRel: Math.abs(floorAfter - floorBefore) / bodyPx,
      lostRel: range(i0, i1).filter((i) => !Number.isFinite(s.toe[i]) || !Number.isFinite(s.hip[i])).length / (i1 - i0 + 1),
      // Around the flight and the floor windows before and after it.
      outsideRel: s.outside ? windowMax(s.t, s.outside, t0 - 0.6, t1 + 0.6) : 0,
      flags: [],
      debug: { i0, i1, floor: floorBefore, bodyPx, hipFit, toeFit },
    };
    if (j.airborneFrames < 8) j.flags.push("few-frames");
    if (hipFit.a >= 0) j.flags.push("not-parabola");
    // Wide bounds: the body-size scale is distorted by camera tilt (a floor-level camera
    // read 6–8.5), but a 2× slow-motion clip still reads ≈ 2.5.
    else if (gImplied < 4 || gImplied > 20) j.flags.push("g-implausible");
    if (Math.max(j.hipRmsRel, j.toeRmsRel) > 0.015) j.flags.push("poor-fit");
    if (Math.abs(hPrimary - hFlight) > 0.15 * hFlight) j.flags.push("disagree");
    if (j.floorShiftRel > 0.02) j.flags.push("camera-moved");
    if (j.lostRel > MAX_LOST || j.outsideRel > MAX_OUTSIDE) j.flags.push("out-of-view");
    if (!(Math.max(hPrimary, hFlight) <= MAX_HEIGHT_RATIO * Math.min(hPrimary, hFlight)) || !(hPrimary <= MAX_RISE_OVER_FLIGHT * hFlight))
      j.flags.push("inconsistent");
    jumps.push(j);
  }
  return jumps;
}

/** A fast toe step: at least this fraction of the jump's fastest rise (or fall). */
const FAST = 0.25;
/** Longest and highest toe creep that is trimmed (seconds, fraction of body height). */
const MAX_CREEP_S = 0.4;
const MAX_CREEP_BODY = 0.1;
/** Toe speed is measured over at least this many seconds (keeps 240 fps noise down). */
const SPEED_SPAN = 0.05;

/**
 * Trims slow toe motion off both ends of an airborne run. Lighter pose models lift the
 * toe point slowly while the heels rise in the push-off and after landing; the real
 * takeoff is the first fast rise, the landing the last fast fall. `before`/`after` are
 * the trimmed contact frames next to the flight, or null when nothing was trimmed.
 */
function trimCreep(
  s: Signals, run: number[], tol: number, floor: number, thr: number, bodyPx: number,
): { frames: number[]; before: number | null; after: number | null } {
  const unchanged = { frames: run, before: null, after: null };
  // The contact frames can lie just outside the run (creep above the threshold): look around it.
  const tFrom = s.t[run[0]] - 0.3, tTo = s.t[run[run.length - 1]] + 0.3;
  const idx: number[] = [];
  for (let i = 0; i < s.t.length; i++)
    if (s.t[i] >= tFrom && s.t[i] <= tTo && Number.isFinite(s.toe[i]) && Number.isFinite(s.hip[i])) idx.push(i);
  // Toe slope (px/s) from frame k to the first frame at least SPEED_SPAN away in direction dir.
  const slope = (k: number, dir: 1 | -1) => {
    let j = k + dir;
    while (j + dir >= 0 && j + dir < idx.length && Math.abs(s.t[idx[j]] - s.t[idx[k]]) < SPEED_SPAN) j += dir;
    if (j < 0 || j >= idx.length) return 0;
    return (s.toe[idx[j]] - s.toe[idx[k]]) / (s.t[idx[j]] - s.t[idx[k]]);
  };
  let peak = 0;
  for (let k = 1; k < idx.length; k++) if (s.toe[idx[k]] > s.toe[idx[peak]]) peak = k;
  // Fastest rise before the peak and fastest fall after it: certainly flight.
  let kUp = 0, kDown = idx.length - 1;
  for (let k = 0; k < peak; k++) if (slope(k, 1) > slope(kUp, 1)) kUp = k;
  for (let k = peak + 1; k < idx.length; k++) if (slope(k, -1) < slope(kDown, -1)) kDown = k;
  const up = slope(kUp, 1), down = -slope(kDown, -1);
  if (up <= 0 || down <= 0) return unchanged;
  // Walk outwards while the toes stay fast; then over frames still at that contact level.
  let a = kUp, b = kDown;
  while (a > 0 && slope(a - 1, 1) >= FAST * up) a--;
  while (b < idx.length - 1 && -slope(b + 1, -1) >= FAST * down) b++;
  const levelA = s.toe[idx[a]], levelB = s.toe[idx[b]];
  while (a < peak - 1 && s.toe[idx[a + 1]] <= levelA + tol) a++;
  while (b > peak + 1 && s.toe[idx[b - 1]] <= levelB + tol) b--;
  // Creep is small and short; no creep (contact at floor level) or something else
  // (a raised foot, walking) leaves that side as it was.
  const creep = (k: number, edge: number) => {
    const lift = s.toe[idx[k]] - floor;
    return lift > thr && lift <= MAX_CREEP_BODY * bodyPx && Math.abs(s.t[idx[k]] - s.t[edge]) <= MAX_CREEP_S;
  };
  const trimA = creep(a, run[0]), trimB = creep(b, run[run.length - 1]);
  if (!trimA && !trimB) return unchanged;
  const start = trimA ? a + 1 : idx.indexOf(run[0]);
  const end = trimB ? b - 1 : idx.indexOf(run[run.length - 1]);
  if (end - start + 1 < 5) return unchanged;
  return { frames: idx.slice(start, end + 1), before: trimA ? idx[a] : null, after: trimB ? idx[b] : null };
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

function windowMax(t: number[], y: number[], from: number, to: number): number {
  let m = 0;
  for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to && Number.isFinite(y[i])) m = Math.max(m, y[i]);
  return m;
}

function windowMedian(t: number[], y: number[], from: number, to: number): number | null {
  return windowQuantile(t, y, from, to, 0.5);
}

function windowQuantile(t: number[], y: number[], from: number, to: number, p: number): number | null {
  const w: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to && Number.isFinite(y[i])) w.push(y[i]);
  if (w.length < 3) return null;
  w.sort((a, b) => a - b);
  return p === 0.5 ? median(w) : w[Math.floor(p * (w.length - 1))];
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
