/** Whole-body centre of mass (image y) from MediaPipe landmarks, de Leva segment masses. NaN if any needed point is missing. */
import type { Landmark } from "../../src/analysis/types";

const mid = (lm: Landmark[], a: number, b: number) => (lm[a][1] + lm[b][1]) / 2;
const along = (p: number, d: number, f: number) => p + f * (d - p);

/** Image y (0–1, down) of the centre of mass. */
export function comY(lm: Landmark[]): number {
  // A point that isn't seen takes the y of its partner on the other side (side view: the far limb hides
  // behind the near one; a symmetric stance is assumed). Points no model gives (the app doesn't log
  // ears, elbows, wrists; COCO models have no heels/toes) fall back to the nose, the trunk (hands on
  // hips) and the ankle.
  const seen = (i: number) => lm[i][3] > 0.3;
  const PAIR: Record<number, number> = { 7: 8, 8: 7, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27, 29: 30, 30: 29, 31: 32, 32: 31 };
  const y = (i: number) => (seen(i) ? lm[i][1] : seen(PAIR[i]) ? lm[PAIR[i]][1] : NaN);
  const or = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  const sh = (y(11) + y(12)) / 2, hip = (y(23) + y(24)) / 2;
  const head = or((y(7) + y(8)) / 2, lm[0][1]);
  let c = 0.0694 * head + 0.4346 * along(sh, hip, 0.45);
  for (const [s, e, w, hp, k, a, he, to] of [[11, 13, 15, 23, 25, 27, 29, 31], [12, 14, 16, 24, 26, 28, 30, 32]]) {
    const ey = or(y(e), along(y(s), y(hp), 0.5));
    const wy = or(y(w), y(hp));
    const ay = y(a);
    c += 0.0271 * along(y(s), ey, 0.577);
    c += 0.0162 * along(ey, wy, 0.457);
    c += 0.0061 * wy;
    c += 0.1416 * along(y(hp), y(k), 0.41);
    c += 0.0433 * along(y(k), ay, 0.44);
    c += 0.0137 * (ay + or(y(he), ay) + or(y(to), ay)) / 3;
  }
  return c;
}

/** Trunk centre: mean of shoulders and hips. */
export function trunkY(lm: Landmark[]): number {
  return (mid(lm, 11, 12) + mid(lm, 23, 24)) / 2;
}
