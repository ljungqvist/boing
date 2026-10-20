/**
 * Experimental copy of src/analysis/jumps.ts with switchable changes, for the accuracy review.
 * With default options it reproduces findJumps exactly (checked by tools/review/check_exp.ts), with the
 * reject list of the apps (poor-fit included).
 */
import { evalQuadratic, fitQuadratic, quadraticRoots, type Quadratic } from "../../src/analysis/fit";
import { toSignals } from "../../src/analysis/signals";
import type { Landmark, PoseVideo, Signals } from "../../src/analysis/types";
import type { Jump, JumpFlag } from "../../src/analysis/jumps";
import { comY, trunkY } from "./com";

export interface ExpOptions {
  /** Keep takeoff between the last contact frame and the first airborne frame (landing likewise). */
  clampEdges?: boolean;
  /** Drop frames at the start (end) of the airborne run that are still at the floor level before (after) the jump. */
  edgeTrim?: boolean;
  /** trimCreep measures the creep from the same rolling floor that started the run (not the floor before). */
  creepRolling?: boolean;
  /** Airborne threshold: toes above the floor by this fraction of body height (current 0.02). */
  thrBody?: number;
  /** Fit the toe parabola only to frames above this fraction of the toe peak (0 = all). */
  toeFitAbove?: number;
  /** Fit the toe parabola only to frames below this fraction of the toe peak (rise and fall, not the top). */
  toeFitBelow?: number;
  /** Floor level for the landing root: before the jump (current) or after it. */
  landFloor?: "before" | "after";
  /** Signal whose parabola vertex is the apex. */
  apex?: "hip" | "trunk" | "com";
  /** Which height is reported as hPrimary. */
  final?: "primary" | "flight" | "mid" | "avg" | "flightCorr";
  /** Frames on each side of an edge searched for the leg length (hip − toe) maximum. */
  legSpan?: number;
  /** Leave this many frames at each end of the flight out of the apex fit. */
  apexTrim?: number;
  /** Extra reject rules. */
  rejectDisagree?: number; // reject when |hP − hF| > this fraction of the smaller
  rejectApexOff?: number; // reject when |tApex − mid| > this fraction of the flight time
  rejectFloorShift?: number; // reject when the floor before and after differ by more than this fraction of body
  rejectScale?: number; // reject when the hip+shoulder width at landing differs from takeoff by more than this fraction
  /** Edge time: quadratic toe root (current) or local fit near the edge. */
  edges?: "toeParabola" | "local" | "perFoot" | "hipLeg" | "knee" | "legPeak" | "legPeakAvg";
  /** knee: half-width of the data window around the run edge (s). */
  kneeWindow?: number;
  /** hipLeg: the edge frames are the first/last with the toes this far above the floor (fraction of body). */
  airLift?: number;
  /** perFoot: "last" = last foot off / first foot down (contact-mat definition), "mean" = average of the feet. */
  feet?: "last" | "mean";
  /** Level above the floor (fraction of body height) at which the toe edge is taken. */
  edgeLift?: number;
}

export interface ExpJump extends Jump {
  tMid: number;
  dLand: number;
  hCorr: number;
  hPfit: number;
  apexOff: number;
  scaleChange: number;
  floorShift: number;
  rejected: boolean;
  extraFlags: string[];
}

const NOSE_TO_HEEL_PER_STATURE = 0.92;
const MAX_OUTSIDE = 0.03;
const MAX_LOST = 0.2;
const MAX_HEIGHT_RATIO = 2;
const MAX_RISE_OVER_FLIGHT = 1.2;
const REJECT: JumpFlag[] = ["not-parabola", "few-frames", "g-implausible", "out-of-view", "inconsistent", "poor-fit"];

export function extraSignals(video: PoseVideo, minVis = 0.5) {
  const H = video.height, W = video.width;
  const ok = (lm: Landmark[] | null, idx: number[]) => !!lm && idx.every((i) => lm[i][3] >= minVis);
  const trunk: number[] = [], com: number[] = [], width: number[] = [];
  for (const f of video.frames) {
    const lm = f.lm;
    trunk.push(ok(lm, [11, 12, 23, 24]) ? H - trunkY(lm!) * H : NaN);
    com.push(ok(lm, [11, 12, 23, 24, 25, 26, 27, 28]) ? H - comY(lm!) * H : NaN);
    width.push(ok(lm, [11, 12, 23, 24]) ? (Math.hypot((lm![11][0] - lm![12][0]) * W, (lm![11][1] - lm![12][1]) * H) + Math.hypot((lm![23][0] - lm![24][0]) * W, (lm![23][1] - lm![24][1]) * H)) : NaN);
  }
  return { trunk, com, width };
}

export function findJumpsExp(video: PoseVideo, opts: ExpOptions = {}, g = 9.81, stature = 1.75): ExpJump[] {
  const s = toSignals(video);
  const extra = extraSignals(video);
  const n = s.t.length;
  const bodyAll = median(s.bodyPx.filter(Number.isFinite));
  if (!Number.isFinite(bodyAll)) return [];

  const sigma = noiseSigma(s.toe);
  const thr = Math.max(4 * sigma, (opts.thrBody ?? 0.02) * bodyAll);
  const floor = rollingPercentile(s.t, s.toe, 1.0, 0.25);

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

  const jumps: ExpJump[] = [];
  for (const [r0, r1] of runs) {
    const dur = s.t[r1] - s.t[r0];
    if (dur < 0.1 || dur > 1.2) continue;
    let i0 = r0, i1 = r1;
    if (opts.edgeTrim) {
      // The rolling floor mixes the floor before and after: landing closer to (or further from) the
      // camera moves it, and standing frames then pass for flight. Judge each edge by its own floor.
      const fb = windowMedian(s.t, s.toe, s.t[r0] - 0.6, s.t[r0] - 0.1);
      const fa = windowMedian(s.t, s.toe, s.t[r1] + 0.1, s.t[r1] + 0.6);
      if (fb !== null) while (i0 < i1 && !(s.toe[i0] - fb > thr)) i0++;
      if (fa !== null) while (i1 > i0 && !(s.toe[i1] - fa > thr)) i1--;
      if (s.t[i1] - s.t[i0] < 0.1) continue;
    }
    const idx = range(i0, i1).filter((i) => Number.isFinite(s.toe[i]) && Number.isFinite(s.hip[i]));
    if (idx.length < 5) continue;
    const t0 = s.t[i0], t1 = s.t[i1];
    const floorBefore = windowMedian(s.t, s.toe, t0 - 0.6, t0 - 0.1) ?? floor[i0];
    const floorAfter = windowMedian(s.t, s.toe, t1 + 0.1, t1 + 0.6) ?? floorBefore;
    const bodyPx = windowQuantile(s.t, s.bodyPx, t0 - 3, t1 + 3, 0.9) ?? bodyAll;

    const fl = trimCreep(s, idx, Math.max(3 * sigma, 0.01 * bodyPx), opts.creepRolling ? Math.min(floorBefore, floor[i0]) : floorBefore, thr, bodyPx);
    const lift = (opts.edgeLift ?? 0) * bodyPx;
    const levelOff = (fl.before !== null ? s.toe[fl.before] : floorBefore) + lift;
    const levelOn = (fl.after !== null ? s.toe[fl.after] : opts.landFloor === "after" ? floorAfter : floorBefore) + lift;
    const tt = fl.frames.map((i) => s.t[i]);
    let toeFrames = fl.frames;
    if (opts.toeFitAbove) {
      const peak = Math.max(...fl.frames.map((i) => s.toe[i] - floorBefore));
      const sel = fl.frames.filter((i) => s.toe[i] - floorBefore >= opts.toeFitAbove! * peak);
      if (sel.length >= 5) toeFrames = sel;
    }
    if (opts.toeFitBelow) {
      const peak = Math.max(...fl.frames.map((i) => s.toe[i] - floorBefore));
      const kPeak = fl.frames.find((i) => s.toe[i] - floorBefore === peak)!;
      const sel = fl.frames.filter((i) => s.toe[i] - floorBefore <= opts.toeFitBelow! * peak);
      // Needs frames on both sides of the top.
      if (sel.length >= 5 && sel.some((i) => i < kPeak) && sel.some((i) => i > kPeak)) toeFrames = sel;
    }
    const toeFit = fitQuadratic(toeFrames.map((i) => s.t[i]), toeFrames.map((i) => s.toe[i]));
    const hipFit = fitQuadratic(tt, fl.frames.map((i) => s.hip[i]));
    let tOff = quadraticRoots(toeFit, levelOff)?.[0] ?? t0;
    let tOn = quadraticRoots(toeFit, levelOn)?.[1] ?? t1;

    // Contact frames around the flight (by time order in the full signal).
    const first = fl.frames[0], last = fl.frames[fl.frames.length - 1];
    let prev = first - 1; while (prev >= 0 && !Number.isFinite(s.toe[prev])) prev--;
    let next = last + 1; while (next < n && !Number.isFinite(s.toe[next])) next++;
    if (opts.edges === "local") {
      // Line through the first two airborne frames back to the level (landing: last two).
      const cross = (a: number, b: number, level: number) => s.t[a] + (level - s.toe[a]) * (s.t[b] - s.t[a]) / (s.toe[b] - s.toe[a]);
      if (fl.frames.length >= 4) {
        const x = cross(fl.frames[0], fl.frames[1], levelOff);
        if (Number.isFinite(x)) tOff = x;
        const y = cross(fl.frames[fl.frames.length - 1], fl.frames[fl.frames.length - 2], levelOn);
        if (Number.isFinite(y)) tOn = y;
      }
    }
    if (opts.edges === "perFoot") {
      const pf = perFootEdges(video, s.t, (tOff + tOn) / 2, tOff - 0.25, tOn + 0.25, (opts.edgeLift ?? 0.03) * bodyPx);
      if (pf) {
        const [offL, offR, onL, onR] = pf;
        if (opts.feet === "mean") { tOff = (offL + offR) / 2; tOn = (onL + onR) / 2; }
        else { tOff = Math.max(offL, offR); tOn = Math.min(onL, onR); }
      }
    }
    if (opts.edges === "knee") {
      // Toe height around each edge as a hinge: a slow line while on the floor (creep), then free
      // flight (the hip parabola's curvature). The hinge time is the edge.
      const W = opts.kneeWindow ?? 0.2;
      const near = (tc: number) => { const out: number[] = []; for (let i = 0; i < n; i++) if (Math.abs(s.t[i] - tc) <= W && Number.isFinite(s.toe[i])) out.push(i); return out; };
      const fitHinge = (frames: number[], from: number, to: number, dir: 1 | -1) => {
        let best = Infinity, bestTau = NaN;
        for (let tau = from; tau <= to; tau += 0.001) {
          // Columns: 1, ground slope (t − τ)⁻ , air slope (t − τ)⁺ ; air curvature fixed (hip's a).
          let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bv = [0, 0, 0], rows: number[][] = [];
          for (const i of frames) {
            const x = s.t[i] - tau;
            const ground = dir === 1 ? x < 0 : x > 0;
            const r = [1, ground ? x : 0, ground ? 0 : x];
            const y = s.toe[i] - (ground ? 0 : hipFit.a * x * x);
            rows.push([...r, y]);
            for (let p = 0; p < 3; p++) { bv[p] += r[p] * y; for (let q = 0; q < 3; q++) A[p][q] += r[p] * r[q]; }
          }
          const nG = rows.filter((r) => r[1] !== 0).length, nA = rows.filter((r) => r[2] !== 0).length;
          if (nG < 2 || nA < 2) continue;
          const sol = solve3(A, bv);
          if (!sol) continue;
          // The air slope must be steeper than the ground one (upwards at takeoff, downwards at landing).
          if (dir === 1 ? !(sol[2] > sol[1]) : !(sol[2] < sol[1])) continue;
          let sse = 0;
          for (const r of rows) sse += (r[3] - (sol[0] * r[0] + sol[1] * r[1] + sol[2] * r[2])) ** 2;
          if (sse < best) { best = sse; bestTau = tau; }
        }
        return bestTau;
      };
      const ka = fitHinge(near(s.t[fl.frames[0]]), s.t[fl.frames[0]] - 0.1, s.t[fl.frames[0]] + 0.15, 1);
      const last = fl.frames[fl.frames.length - 1];
      const kb = fitHinge(near(s.t[last]), s.t[last] - 0.15, s.t[last] + 0.1, -1);
      if (Number.isFinite(ka)) tOff = ka;
      if (Number.isFinite(kb)) tOn = kb;
    }
    if (opts.edges === "legPeak" || opts.edges === "legPeakAvg") {
      // Takeoff = when the legs (hip − toe) are longest: they extend in the push-off and are pulled up
      // right after the toes leave (−11 ± 7 ms against the hand-marked takeoff at 240 fps).
      const leg = (i: number) => s.hip[i] - s.toe[i];
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (Math.abs(s.t[i] - tOff) > 0.1 || !Number.isFinite(leg(i))) continue;
        if (best < 0 || leg(i) > leg(best)) best = i;
      }
      if (best > 0 && best < n - 1 && Number.isFinite(leg(best - 1)) && Number.isFinite(leg(best + 1))) {
        const q = fitQuadratic([s.t[best - 1], s.t[best], s.t[best + 1]], [leg(best - 1), leg(best), leg(best + 1)]);
        const peak = q.a < 0 ? Math.min(Math.max(q.vertex, s.t[best - 1]), s.t[best + 1]) : s.t[best];
        tOff = opts.edges === "legPeak" ? peak : (tOff + peak) / 2;
      }
    }
    if (opts.edges === "hipLeg") {
      // The first and last frames clearly in the air; from there the toe is moved back to the floor
      // along the hip parabola (legs taken as rigid for that last bit).
      const air = (opts.airLift ?? 0.035) * bodyPx;
      const mid = hipFit.vertex;
      let a = -1, b = -1;
      for (const i of fl.frames) if (s.t[i] <= mid && s.toe[i] - levelOff > air) { a = i; break; }
      for (let k = fl.frames.length - 1; k >= 0; k--) { const i = fl.frames[k]; if (s.t[i] >= mid && s.toe[i] - levelOn > air) { b = i; break; } }
      if (a >= 0 && b >= 0) {
        const Pa = evalQuadratic(hipFit, s.t[a]), Pb = evalQuadratic(hipFit, s.t[b]);
        const ra = quadraticRoots(hipFit, Pa - (s.toe[a] - levelOff));
        const rb = quadraticRoots(hipFit, Pb - (s.toe[b] - levelOn));
        if (ra) tOff = ra[0];
        if (rb) tOn = rb[1];
        // Never before the last frame on the floor (toe within `air` of it) or after the next one in the air.
        let c = a - 1; while (c >= 0 && !(Number.isFinite(s.toe[c]) && s.toe[c] - levelOff <= air * 0.5)) c--;
        let d = b + 1; while (d < n && !(Number.isFinite(s.toe[d]) && s.toe[d] - levelOn <= air * 0.5)) d++;
        if (c >= 0) tOff = Math.max(tOff, s.t[c]);
        tOff = Math.min(tOff, s.t[a]);
        if (d < n) tOn = Math.min(tOn, s.t[d]);
        tOn = Math.max(tOn, s.t[b]);
      }
    }
    if (opts.clampEdges && opts.edges !== "perFoot" && opts.edges !== "hipLeg") {
      if (prev >= 0) tOff = Math.max(tOff, s.t[prev]);
      tOff = Math.min(tOff, s.t[first]);
      if (next < n) tOn = Math.min(tOn, s.t[next]);
      tOn = Math.max(tOn, s.t[last]);
    }

    // Apex signal and frames.
    const apexSig = opts.apex === "trunk" ? extra.trunk : opts.apex === "com" ? extra.com : s.hip;
    const k = opts.apexTrim ?? 0;
    let apexFrames = fl.frames.slice(k, fl.frames.length - k).filter((i) => Number.isFinite(apexSig[i]));
    if (apexFrames.length < 5) apexFrames = fl.frames.filter((i) => Number.isFinite(apexSig[i]));
    const apexFit = apexFrames.length >= 3 ? fitQuadratic(apexFrames.map((i) => s.t[i]), apexFrames.map((i) => apexSig[i])) : hipFit;
    let tApex = apexFit.a < 0 ? apexFit.vertex : hipFit.vertex;
    const tMid = (tOff + tOn) / 2;

    const pxPerMetre = bodyPx / (NOSE_TO_HEEL_PER_STATURE * stature);
    const gImplied = (-2 * hipFit.a) / pxPerMetre;
    const hPfit = (g / 2) * (tApex - tOff) ** 2;
    const hFlight = (g * (tOn - tOff) ** 2) / 8;
    let hPrimary = Math.min(hPfit, hFlight); // as findJumps: never above the flight-time height
    if (opts.final === "flight") hPrimary = hFlight;
    if (opts.final === "mid") hPrimary = (g / 2) * (tMid - tOff) ** 2;
    if (opts.final === "avg") hPrimary = (g / 2) * ((tApex + tMid) / 2 - tOff) ** 2;
    // Leg length (hip − toe, px) at takeoff and touchdown: the largest within ±span s of each edge.
    const span = opts.legSpan ?? 0.04;
    const legAt = (te: number) => { let m = NaN; for (let i = 0; i < n; i++) if (Math.abs(s.t[i] - te) <= span) { const L = s.hip[i] - s.toe[i]; if (Number.isFinite(L) && !(L <= m)) m = L; } return m; };
    const L1 = legAt(tOff), L2 = legAt(tOn);
    const sPx = -2 * hipFit.a / g;
    const dLand = (L1 - L2) / sPx; // metres the hips are lower at touchdown than at takeoff
    const kk = (tOn - tOff) * Math.sqrt(g / 2);
    const hCorr = Number.isFinite(dLand) && sPx > 0 ? (Math.sqrt(hFlight) - dLand / (2 * kk)) ** 2 : hFlight;
    if (opts.final === "flightCorr") hPrimary = hCorr;

    // Body scale (shoulder + hip width) just before takeoff and just after landing.
    const wBefore = windowMedianAny(s.t, extra.width, tOff - 0.12, tOff);
    const wAfter = windowMedianAny(s.t, extra.width, tOn, tOn + 0.12);
    const scaleChange = wBefore && wAfter ? wAfter / wBefore - 1 : 0;

    const j: ExpJump = {
      tOff, tOn, tApex, hPrimary, hRise: hPfit, hFlight,
      airborneFrames: fl.frames.length,
      gImplied,
      hipRmsRel: hipFit.rms / bodyPx,
      toeRmsRel: toeFit.rms / bodyPx,
      floorShiftRel: Math.abs(floorAfter - floorBefore) / bodyPx,
      lostRel: range(i0, i1).filter((i) => !Number.isFinite(s.toe[i]) || !Number.isFinite(s.hip[i])).length / (i1 - i0 + 1),
      outsideRel: s.outside ? windowMax(s.t, s.outside, t0 - 0.6, t1 + 0.6) : 0,
      flags: [],
      debug: { i0, i1, floor: floorBefore, bodyPx, hipFit, toeFit },
      tMid, apexOff: tApex - tMid, dLand, hCorr, hPfit, scaleChange, floorShift: (floorAfter - floorBefore) / bodyPx,
      rejected: false, extraFlags: [],
    };
    if (j.airborneFrames < 8) j.flags.push("few-frames");
    if (hipFit.a >= 0) j.flags.push("not-parabola");
    else if (gImplied < 4 || gImplied > 20) j.flags.push("g-implausible");
    if (Math.max(j.hipRmsRel, j.toeRmsRel) > 0.015) j.flags.push("poor-fit");
    if (Math.abs(hPfit - hFlight) > 0.15 * hFlight) j.flags.push("disagree");
    if (j.floorShiftRel > 0.02) j.flags.push("camera-moved");
    if (j.lostRel > MAX_LOST || j.outsideRel > MAX_OUTSIDE) j.flags.push("out-of-view");
    if (!(Math.max(hPfit, hFlight) <= MAX_HEIGHT_RATIO * Math.min(hPfit, hFlight)) || !(hPfit <= MAX_RISE_OVER_FLIGHT * hFlight)) j.flags.push("inconsistent");
    if (opts.rejectDisagree !== undefined && Math.abs(hPfit - hFlight) > opts.rejectDisagree * Math.min(hPfit, hFlight)) j.extraFlags.push("disagree-x");
    if (opts.rejectApexOff !== undefined && Math.abs(j.apexOff) > opts.rejectApexOff * (tOn - tOff)) j.extraFlags.push("apex-off");
    if (opts.rejectFloorShift !== undefined && j.floorShiftRel > opts.rejectFloorShift) j.extraFlags.push("floor-shift");
    if (opts.rejectScale !== undefined && Math.abs(scaleChange) > opts.rejectScale) j.extraFlags.push("scale-change");
    j.rejected = j.flags.some((f) => REJECT.includes(f)) || j.extraFlags.length > 0;
    jumps.push(j);
  }
  return jumps;
}

/**
 * Per foot: when the toe point rises through (its floor before + lift) last before `mid`, and falls
 * through (its floor after + lift) first after it; linear interpolation between frames.
 * Returns [offL, offR, onL, onR] or null if any is missing.
 */
function perFootEdges(video: PoseVideo, t: number[], mid: number, from: number, to: number, lift: number): number[] | null {
  const H = video.height;
  const out: number[] = [];
  const offs: number[] = [], ons: number[] = [];
  for (const toe of [31, 32]) {
    const y = video.frames.map((f) => (f.lm && f.lm[toe][3] >= 0.5 ? H - f.lm[toe][1] * H : NaN));
    const flB = windowMedian(t, y, from - 0.6, from - 0.1 + 0.25);
    const flA = windowMedian(t, y, to + 0.1 - 0.25, to + 0.6);
    if (flB === null || flA === null) return null;
    let up = NaN, down = NaN, prev = -1;
    for (let i = 0; i < t.length; i++) {
      if (!Number.isFinite(y[i]) || t[i] < from || t[i] > to) continue;
      if (prev >= 0) {
        const a = prev, b = i;
        if (t[b] <= mid && y[a] <= flB + lift && y[b] > flB + lift) up = t[a] + (flB + lift - y[a]) / (y[b] - y[a]) * (t[b] - t[a]);
        if (t[a] >= mid && Number.isNaN(down) && y[a] > flA + lift && y[b] <= flA + lift) down = t[a] + (y[a] - flA - lift) / (y[a] - y[b]) * (t[b] - t[a]);
      }
      prev = i;
    }
    if (!Number.isFinite(up) || !Number.isFinite(down)) return null;
    offs.push(up); ons.push(down);
  }
  out.push(offs[0], offs[1], ons[0], ons[1]);
  return out;
}

// ---- unchanged helpers from src/analysis/jumps.ts ----
const FAST = 0.25;
const MAX_CREEP_S = 0.4;
const MAX_CREEP_BODY = 0.1;
const SPEED_SPAN = 0.05;

function trimCreep(
  s: Signals, run: number[], tol: number, floor: number, thr: number, bodyPx: number,
): { frames: number[]; before: number | null; after: number | null } {
  const unchanged = { frames: run, before: null, after: null };
  const tFrom = s.t[run[0]] - 0.3, tTo = s.t[run[run.length - 1]] + 0.3;
  const idx: number[] = [];
  for (let i = 0; i < s.t.length; i++)
    if (s.t[i] >= tFrom && s.t[i] <= tTo && Number.isFinite(s.toe[i]) && Number.isFinite(s.hip[i])) idx.push(i);
  const slope = (k: number, dir: 1 | -1) => {
    let j = k + dir;
    while (j + dir >= 0 && j + dir < idx.length && Math.abs(s.t[idx[j]] - s.t[idx[k]]) < SPEED_SPAN) j += dir;
    if (j < 0 || j >= idx.length) return 0;
    return (s.toe[idx[j]] - s.toe[idx[k]]) / (s.t[idx[j]] - s.t[idx[k]]);
  };
  let peak = 0;
  for (let k = 1; k < idx.length; k++) if (s.toe[idx[k]] > s.toe[idx[peak]]) peak = k;
  let kUp = 0, kDown = idx.length - 1;
  for (let k = 0; k < peak; k++) if (slope(k, 1) > slope(kUp, 1)) kUp = k;
  for (let k = peak + 1; k < idx.length; k++) if (slope(k, -1) < slope(kDown, -1)) kDown = k;
  const up = slope(kUp, 1), down = -slope(kDown, -1);
  if (up <= 0 || down <= 0) return unchanged;
  let a = kUp, b = kDown;
  while (a > 0 && slope(a - 1, 1) >= FAST * up) a--;
  while (b < idx.length - 1 && -slope(b + 1, -1) >= FAST * down) b++;
  const levelA = s.toe[idx[a]], levelB = s.toe[idx[b]];
  while (a < peak - 1 && s.toe[idx[a + 1]] <= levelA + tol) a++;
  while (b > peak + 1 && s.toe[idx[b - 1]] <= levelB + tol) b--;
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

function noiseSigma(y: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < y.length; i++) if (Number.isFinite(y[i]) && Number.isFinite(y[i - 1])) d.push(y[i] - y[i - 1]);
  if (d.length === 0) return 0;
  const m = median(d);
  return (1.4826 * median(d.map((x) => Math.abs(x - m)))) / Math.SQRT2;
}

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
function solve3(m: number[][], v: number[]): number[] | null {
  const A = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let p = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) return null;
    for (let r = col + 1; r < 3; r++) { const f = A[r][col] / A[col][col]; for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k]; }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let t = A[r][3]; for (let k = r + 1; k < 3; k++) t -= A[r][k] * x[k]; x[r] = t / A[r][r]; }
  return x;
}
function windowMedianAny(t: number[], y: number[], from: number, to: number): number | null {
  const w: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to && Number.isFinite(y[i])) w.push(y[i]);
  return w.length ? median(w) : null;
}
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
export { evalQuadratic, type Quadratic };
