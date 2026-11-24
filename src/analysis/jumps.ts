import { evalQuadratic, fitQuadratic, quadraticRoots, type Quadratic } from "./fit";
import type { Signals } from "./types";

export interface JumpOptions {
  /** Jumper's body height in metres; only used for the implied-g check. */
  stature?: number;
  g?: number;
  /** Where the apex comes from: the whole-body centre of mass (default; the hips where it can't be fitted) or the hips. */
  apex?: "com" | "hip";
  /**
   * Where the takeoff comes from: the feet (default; the first of several frames with the lowest heel or toe clearly
   * off the floor, halfway to the frame before) or where the toe parabola crosses the floor level.
   */
  takeoff?: "feet" | "toe-parabola";
}

export type JumpFlag =
  | "few-frames"      // too few airborne frames for a reliable fit
  | "g-implausible"   // hip curvature far from gravity: wrong time base (slow motion) or not a jump
  | "not-parabola"    // hip isn't decelerating during "flight"
  | "poor-fit"        // large residuals: tucked legs, bad keypoints
  | "disagree"        // takeoff→apex and flight-time heights differ: bent-knee landing?
  | "camera-moved"    // floor line differs before and after the jump
  | "out-of-view"     // hips or feet left the picture, or the person was lost in the flight: too close?
  | "inconsistent"     // takeoff→apex and flight-time heights can't be one flight (or the apex comes too late)
  | "toe-plateau";     // note: feet pulled up in the air; edges taken along the hips instead of the toe curve

export interface Jump {
  tOff: number;
  tOn: number;
  tApex: number;
  /**
   * The height shown, metres: takeoff to apex, g/2·(tApex − tOff)², but at most the flight-time
   * height. A jump can't land higher than it took off, so a rise above the flight-time height is a
   * late apex (moving towards the camera in the air, unsteady hip points); the flight time is then
   * the better of the two.
   */
  hPrimary: number;
  /** Takeoff to apex, g/2·(tApex − tOff)², metres, not capped. */
  hRise: number;
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
  /** Which signal's vertex is the apex: the whole-body centre of mass, or the hips where it couldn't be fitted. */
  apexFrom: "com" | "hip";
  /** Where the takeoff came from: the feet leaving the floor, or the toe parabola where the feet rule found none. */
  takeoffFrom: "feet" | "toe-parabola";
  /** Details for plotting/debugging. */
  debug: { i0: number; i1: number; floor: number; bodyPx: number; hipFit: Quadratic; toeFit: Quadratic; comFit: Quadratic | null };
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
 * Moving towards a floor-level camera in the air shifts the hips' apex late and reads 28–71 cm for a
 * 16 cm jump; normal jumps stay below ≈ 1.15 at 30 fps.
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
    let tOff = quadraticRoots(toeFit, level(fl.before))?.[0] ?? t0;
    let tOn = quadraticRoots(toeFit, level(fl.after))?.[1] ?? t1;
    const comFit = opts.apex === "hip" ? null : centreOfMassFit(s, fl.frames);
    const tApex = comFit ? comFit.vertex : hipFit.vertex;

    // Feet pulled up in the air: the toes plateau and their parabola puts the edges wrong (takeoff late,
    // apex early), while the hips still fly a clean parabola. Then the edges come from the hips: the first
    // and last frames clearly in the air, the toes moved back to the floor along the hip parabola.
    let plateau = false;
    if (toeFit.rms / bodyPx > POOR_FIT && hipFit.rms / bodyPx <= POOR_FIT && hipFit.a < 0) {
      const e = hipEdges(s, fl.frames, hipFit, level(fl.before), level(fl.after), bodyPx);
      if (e) {
        const rise = (g / 2) * (tApex - e.tOff) ** 2, flight = (g * (e.tOn - e.tOff) ** 2) / 8;
        if (Math.max(rise, flight) <= PLATEAU_RATIO * Math.min(rise, flight)) {
          tOff = e.tOff;
          tOn = e.tOn;
          plateau = true;
        }
      }
    }

    const feetOff = opts.takeoff === "toe-parabola" ? null : feetTakeoff(s, tOff);
    if (feetOff !== null) tOff = feetOff;

    const pxPerMetre = bodyPx / (NOSE_TO_HEEL_PER_STATURE * stature);
    const gImplied = (-2 * hipFit.a) / pxPerMetre;
    const hRise = (g / 2) * (tApex - tOff) ** 2;
    const hFlight = (g * (tOn - tOff) ** 2) / 8;
    const hPrimary = Math.min(hRise, hFlight);

    const j: Jump = {
      tOff, tOn, tApex, hPrimary, hRise, hFlight,
      airborneFrames: fl.frames.length,
      gImplied,
      hipRmsRel: hipFit.rms / bodyPx,
      toeRmsRel: toeFit.rms / bodyPx,
      floorShiftRel: Math.abs(floorAfter - floorBefore) / bodyPx,
      lostRel: range(i0, i1).filter((i) => !Number.isFinite(s.toe[i]) || !Number.isFinite(s.hip[i])).length / (i1 - i0 + 1),
      // Around the flight and the floor windows before and after it.
      outsideRel: s.outside ? windowMax(s.t, s.outside, t0 - 0.6, t1 + 0.6) : 0,
      flags: [],
      apexFrom: comFit ? "com" : "hip",
      takeoffFrom: feetOff !== null ? "feet" : "toe-parabola",
      debug: { i0, i1, floor: floorBefore, bodyPx, hipFit, toeFit, comFit },
    };
    if (j.airborneFrames < 8) j.flags.push("few-frames");
    if (hipFit.a >= 0) j.flags.push("not-parabola");
    // Wide bounds: the body-size scale is distorted by camera tilt (a floor-level camera
    // read 6–8.5), but a 2× slow-motion clip still reads ≈ 2.5.
    else if (gImplied < 4 || gImplied > 20) j.flags.push("g-implausible");
    if (plateau) j.flags.push("toe-plateau");
    else if (Math.max(j.hipRmsRel, j.toeRmsRel) > POOR_FIT) j.flags.push("poor-fit");
    if (Math.abs(hRise - hFlight) > 0.15 * hFlight) j.flags.push("disagree");
    if (j.floorShiftRel > 0.02) j.flags.push("camera-moved");
    if (j.lostRel > MAX_LOST || j.outsideRel > MAX_OUTSIDE) j.flags.push("out-of-view");
    if (!(Math.max(hRise, hFlight) <= MAX_HEIGHT_RATIO * Math.min(hRise, hFlight)) || !(hRise <= MAX_RISE_OVER_FLIGHT * hFlight))
      j.flags.push("inconsistent");
    jumps.push(j);
  }
  return jumps;
}

/** A foot is off the floor when its lowest point is this many leg lengths (hips → ankles) above the floor. */
const FEET_LIFT = 0.05;
/** Frames in a row that must be off the floor for a takeoff. */
const FEET_RUN = 3;
/** The feet's takeoff is looked for this far (s) around the toe parabola's; the floor level just before that. */
const FEET_SEARCH = 0.11;
const FLOOR_FROM = 0.2, FLOOR_TO = 0.03;

/**
 * Takeoff from the feet: the first of FEET_RUN frames in a row with the lowest heel or toe more than FEET_LIFT leg
 * lengths above the floor level, halfway back to the frame before it (which must be on the floor). The toe parabola
 * crosses the floor too early: the toes leave the floor last and slowly, so the flight parabola through them starts
 * before the feet are off. Null when the frames don't show it (missing points, no clear floor).
 */
export function feetTakeoff(s: Signals, near: number): number | null {
  if (!s.foot || !s.legPx) return null;
  const leg = median(s.legPx.filter((x, i) => Number.isFinite(x) && Math.abs(s.t[i] - near) < 1));
  const ok: number[] = [];
  for (let i = 0; i < s.t.length; i++) if (Number.isFinite(s.foot[i]) && Math.abs(s.t[i] - near) < 1) ok.push(i);
  const floorPts = ok.filter((i) => s.t[i] > near - FLOOR_FROM && s.t[i] < near - FLOOR_TO).map((i) => s.foot![i]);
  if (!(leg > 0) || floorPts.length < 3) return null;
  const floor = median(floorPts);
  const up = (i: number) => (s.foot![i] - floor) / leg > FEET_LIFT;
  for (let k = 1; k + FEET_RUN <= ok.length; k++) {
    if (Math.abs(s.t[ok[k]] - near) >= FEET_SEARCH) continue;
    if (up(ok[k - 1])) continue;
    let run = true;
    for (let b = 0; b < FEET_RUN; b++) if (!up(ok[k + b])) run = false;
    if (run) return (s.t[ok[k - 1]] + s.t[ok[k]]) / 2;
  }
  return null;
}

/** Most of the flight frames that may lack a centre of mass before the apex falls back to the hips. */
const MAX_COM_MISSING = 0.2;

/**
 * Parabola through the whole-body centre of mass over the flight frames, or null when too many frames lack one or it
 * doesn't open downwards. In free flight the centre of mass flies a parabola whatever the limbs do; the hips alone
 * peak early or late when the knees come up or the legs swing back.
 */
function centreOfMassFit(s: Signals, frames: number[]): Quadratic | null {
  if (!s.com) return null;
  const ok = frames.filter((i) => Number.isFinite(s.com![i]));
  if (ok.length < 5 || ok.length < (1 - MAX_COM_MISSING) * frames.length) return null;
  const q = fitQuadratic(ok.map((i) => s.t[i]), ok.map((i) => s.com![i]));
  return q.a < 0 ? q : null;
}

/** Residuals above this fraction of body height: the points don't follow a parabola. */
export const POOR_FIT = 0.015;
/**
 * The hip-based edges of a toe plateau are used if their two heights agree within this factor
 * (recovers plateau jumps without changing others).
 */
export const PLATEAU_RATIO = 1.3;
/** Toes this far above the floor (fraction of body height) count as clearly in the air. */
const AIR_LIFT = 0.035;

/**
 * Takeoff and landing from the hips: the first and last frames with the toes clearly in the air,
 * moved back to the floor along the hip parabola (legs taken as rigid for that last bit), and kept
 * between the last frame on the floor and the first in the air.
 */
export function hipEdges(s: Signals, frames: number[], hipFit: Quadratic, levelOff: number, levelOn: number, bodyPx: number) {
  const air = AIR_LIFT * bodyPx;
  const mid = hipFit.vertex;
  const a = frames.find((i) => s.t[i] <= mid && s.toe[i] - levelOff > air);
  const b = [...frames].reverse().find((i) => s.t[i] >= mid && s.toe[i] - levelOn > air);
  if (a === undefined || b === undefined) return null;
  const ra = quadraticRoots(hipFit, evalQuadratic(hipFit, s.t[a]) - (s.toe[a] - levelOff));
  const rb = quadraticRoots(hipFit, evalQuadratic(hipFit, s.t[b]) - (s.toe[b] - levelOn));
  if (!ra || !rb) return null;
  let tOff = ra[0], tOn = rb[1];
  let c = a - 1; while (c >= 0 && !(Number.isFinite(s.toe[c]) && s.toe[c] - levelOff <= air * 0.5)) c--;
  let d = b + 1; while (d < s.t.length && !(Number.isFinite(s.toe[d]) && s.toe[d] - levelOn <= air * 0.5)) d++;
  if (c >= 0) tOff = Math.max(tOff, s.t[c]);
  tOff = Math.min(tOff, s.t[a]);
  if (d < s.t.length) tOn = Math.min(tOn, s.t[d]);
  tOn = Math.max(tOn, s.t[b]);
  return { tOff, tOn };
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
