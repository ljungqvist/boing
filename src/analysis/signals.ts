import type { Landmark, PoseVideo, Signals } from "./types";

// MediaPipe pose landmark indices.
const NOSE = 0;
const HIPS = [23, 24];
const HEELS = [29, 30];
const TOES = [31, 32]; // "foot index"
const EARS = [7, 8];
const SHOULDERS = [11, 12];

/**
 * Body segments for the centre of mass: mass fraction, and where along proximal → distal point its own centre lies
 * (de Leva 1996, male). Among full-body tables the choice moves the apex by about ±1 ms; leaving the legs or arms
 * out moves it by up to tens of ms on jumps with the knees pulled up.
 */
const HEAD = 0.0694;
const TRUNK = { m: 0.4346, f: 0.4486 }; // shoulder midpoint → hip midpoint
const LIMB_SEGMENTS: { m: number; f: number; from: number[]; to: number[] }[] = [
  { m: 0.0271, f: 0.5772, from: [11, 12], to: [13, 14] }, // upper arm: shoulder → elbow
  { m: 0.0162, f: 0.4574, from: [13, 14], to: [15, 16] }, // forearm: elbow → wrist
  { m: 0.0061, f: 0, from: [15, 16], to: [15, 16] },      // hand: at the wrist
  { m: 0.1416, f: 0.4095, from: [23, 24], to: [25, 26] }, // thigh: hip → knee
  { m: 0.0433, f: 0.4459, from: [25, 26], to: [27, 28] }, // shank: knee → ankle
  { m: 0.0137, f: 0.4415, from: [29, 30], to: [31, 32] }, // foot: heel → toe
];
const MASS = HEAD + TRUNK.m + 2 * LIMB_SEGMENTS.reduce((a, s) => a + s.m, 0);

export interface SignalOptions {
  /** Landmarks below this visibility are treated as missing. */
  minVisibility?: number;
  /**
   * Average the visible ones of a pair (toes, heels, hips) instead of needing both (default): from the
   * side the far foot hides behind the near one, and without this no side-on jump is measured. On
   * front-view jumps it is equal or a little better.
   */
  anyOfPair?: boolean;
}

export function toSignals(video: PoseVideo, opts: SignalOptions = {}): Signals {
  const minVis = opts.minVisibility ?? 0.5;
  const anyOfPair = opts.anyOfPair ?? true;
  const H = video.height;
  const W = video.width;
  const s: Signals = { t: [], hip: [], toe: [], bodyPx: [], outside: [], com: [], foot: [], legPx: [] };

  // Mean image-y (0–1, down) of the given points, NaN if any is unusable.
  const meanY = (lm: Landmark[] | null, idx: number[]) => {
    if (!lm) return NaN;
    let sum = 0, k = 0;
    for (const i of idx) {
      if (lm[i][3] < minVis) {
        if (anyOfPair) continue;
        return NaN;
      }
      sum += lm[i][1];
      k++;
    }
    return k ? sum / k : NaN;
  };
  const up = (y: number) => H - y * H;
  const outside = (lm: Landmark[] | null) => {
    if (!lm) return NaN;
    let d = 0;
    for (const i of [...HIPS, ...HEELS, ...TOES]) {
      const [x, y, , vis] = lm[i];
      if (vis >= minVis) d = Math.max(d, -x, x - 1, -y, y - 1);
    }
    return d;
  };

  for (const f of video.frames) {
    s.t.push(f.t);
    s.hip.push(up(meanY(f.lm, HIPS)));
    s.toe.push(up(meanY(f.lm, TOES)));
    s.bodyPx.push((meanY(f.lm, HEELS) - meanY(f.lm, [NOSE])) * H);
    s.outside!.push(outside(f.lm));
    s.com!.push(up(comY(f.lm, minVis)));
    s.foot!.push(up(lowestY(f.lm, [...HEELS, ...TOES], minVis)));
    s.legPx!.push(legLength(f.lm, W, H, minVis));
  }
  return s;
}

/** Image y (0–1, down) of the lowest visible of the given points, NaN if none is visible. */
function lowestY(lm: Landmark[] | null, idx: number[], minVis: number): number {
  if (!lm) return NaN;
  let y = NaN;
  for (const i of idx) if (lm[i][3] >= minVis && !(lm[i][1] <= y)) y = lm[i][1];
  return y;
}

/** Pixels from the hip midpoint to the ankle midpoint, NaN unless both hips and both ankles are visible. */
function legLength(lm: Landmark[] | null, W: number, H: number, minVis: number): number {
  if (!lm || [23, 24, 27, 28].some((i) => lm[i][3] < minVis)) return NaN;
  const dx = ((lm[23][0] + lm[24][0]) / 2 - (lm[27][0] + lm[28][0]) / 2) * W;
  const dy = ((lm[23][1] + lm[24][1]) / 2 - (lm[27][1] + lm[28][1]) / 2) * H;
  return Math.hypot(dx, dy);
}

/** A point the model doesn't give at all (the app's logged pose keeps only some): visibility 0 at (0, 0). */
const absent = (p: Landmark) => p[3] === 0 && p[0] === 0 && p[1] === 0;

/**
 * Image y (0–1, down) of the whole-body centre of mass, NaN without a usable body. Needs the hips, knees, ankles and
 * shoulders on at least one side and a toe or heel; a hidden point of a pair (side view: the far limb) takes its
 * partner's y. Points the pose lacks altogether fall back: the head to the nose, an elbow to halfway down the trunk,
 * a wrist to the hip, a foot to the ankle.
 */
export function comY(lm: Landmark[] | null, minVis = 0.5): number {
  if (!lm) return NaN;
  const seen = (i: number) => !absent(lm[i]) && lm[i][3] >= minVis;
  const partner = (i: number) => (i % 2 ? i + 1 : i - 1);
  // A point's y: its own if seen, else its partner's if seen, else its own as placed if the model gave one.
  const y = (i: number) => (seen(i) ? lm[i][1] : seen(partner(i)) ? lm[partner(i)][1] : absent(lm[i]) ? NaN : lm[i][1]);
  for (const i of [11, 23, 25, 27]) if (!seen(i) && !seen(partner(i))) return NaN;
  const pair = (idx: number[]) => (y(idx[0]) + y(idx[1])) / 2;
  const or = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  const shoulder = pair(SHOULDERS), hip = pair(HIPS);
  const head = or(pair(EARS), lm[0][1]);
  let c = HEAD * head + TRUNK.m * (shoulder + TRUNK.f * (hip - shoulder));
  for (const side of [0, 1]) {
    const fallback: Record<number, number> = {
      13: shoulder + 0.5 * (hip - shoulder), 14: shoulder + 0.5 * (hip - shoulder), 15: y(23), 16: y(24),
      29: y(27), 30: y(28), 31: y(27), 32: y(28),
    };
    const at = (i: number) => or(y(i), fallback[i]);
    for (const seg of LIMB_SEGMENTS) {
      const a = at(seg.from[side]), b = at(seg.to[side]);
      c += seg.m * (a + seg.f * (b - a));
    }
  }
  return c / MASS;
}
