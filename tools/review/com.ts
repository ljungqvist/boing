/** Whole-body centre of mass (image y) from MediaPipe landmarks, de Leva segment masses. NaN if any needed point is missing. */
import type { Landmark } from "../../src/analysis/types";

const mid = (lm: Landmark[], a: number, b: number) => (lm[a][1] + lm[b][1]) / 2;
const along = (p: number, d: number, f: number) => p + f * (d - p);

/** Image y (0–1, down) of the centre of mass. */
export function comY(lm: Landmark[]): number {
  const sh = mid(lm, 11, 12), hip = mid(lm, 23, 24);
  // Points the app doesn't log (ears, elbows, wrists: visibility 0) fall back to the nose and, for
  // the arms, to the trunk (hands on hips).
  const seen = (i: number) => lm[i][3] > 0;
  const head = seen(7) && seen(8) ? mid(lm, 7, 8) : lm[0][1];
  let y = 0.0694 * head + 0.4346 * along(sh, hip, 0.45);
  for (const [s, e, w, hp, k, a, he, to] of [[11, 13, 15, 23, 25, 27, 29, 31], [12, 14, 16, 24, 26, 28, 30, 32]]) {
    const ey = seen(e) ? lm[e][1] : along(lm[s][1], lm[hp][1], 0.5);
    const wy = seen(w) ? lm[w][1] : lm[hp][1];
    y += 0.0271 * along(lm[s][1], ey, 0.577);
    y += 0.0162 * along(ey, wy, 0.457);
    y += 0.0061 * wy;
    y += 0.1416 * along(lm[hp][1], lm[k][1], 0.41);
    y += 0.0433 * along(lm[k][1], lm[a][1], 0.44);
    y += 0.0137 * (lm[a][1] + lm[he][1] + lm[to][1]) / 3;
  }
  return y;
}

/** Trunk centre: mean of shoulders and hips. */
export function trunkY(lm: Landmark[]): number {
  return (mid(lm, 11, 12) + mid(lm, 23, 24)) / 2;
}
