import { describe, expect, it } from "vitest";
import { comY, toSignals } from "./signals";
import type { Landmark, PoseVideo } from "./types";

function frame(t: number, ys: Record<number, number>, vis = 0.9) {
  const lm: Landmark[] = Array.from({ length: 33 }, (_, i) => [0.5, ys[i] ?? 0.5, 0, vis]);
  return { t, lm };
}

const video = (frames: PoseVideo["frames"]): PoseVideo => ({ width: 100, height: 200, fps: 30, frames });

describe("toSignals", () => {
  it("converts to height-up pixels and averages left/right", () => {
    const s = toSignals(video([frame(0, { 0: 0.1, 23: 0.5, 24: 0.6, 29: 0.9, 30: 0.9, 31: 0.95, 32: 0.97 })]));
    expect(s.t).toEqual([0]);
    expect(s.hip[0]).toBeCloseTo(200 - 0.55 * 200);
    expect(s.toe[0]).toBeCloseTo(200 - 0.96 * 200);
    expect(s.bodyPx[0]).toBeCloseTo((0.9 - 0.1) * 200);
  });

  it("marks missing poses and low-visibility points as NaN", () => {
    const s = toSignals(video([{ t: 0, lm: null }, frame(1 / 30, {}, 0.1)]));
    expect(s.hip.every(Number.isNaN)).toBe(true);
    expect(s.toe.every(Number.isNaN)).toBe(true);
    expect(s.t).toEqual([0, 1 / 30]);
  });

  it("uses the visible one of a pair when the other is hidden (side view: the far foot)", () => {
    const f = frame(0, { 0: 0.1, 23: 0.5, 24: 0.6, 29: 0.9, 30: 0.9, 31: 0.95, 32: 0.97 });
    f.lm[32][3] = 0.2; // far toe hidden
    const s = toSignals(video([f]));
    expect(s.toe[0]).toBeCloseTo(200 - 0.95 * 200);
    expect(s.hip[0]).toBeCloseTo(200 - 0.55 * 200);
    // Both hidden: missing.
    f.lm[31][3] = 0.2;
    expect(Number.isNaN(toSignals(video([f])).toe[0])).toBe(true);
    // The old behaviour on request.
    f.lm[31][3] = 0.9;
    expect(Number.isNaN(toSignals(video([f]), { anyOfPair: false }).toe[0])).toBe(true);
  });

  it("measures how far the hips and feet lie outside the picture", () => {
    const s = toSignals(video([
      frame(0, { 0: 0.1, 23: 0.5, 24: 0.5, 29: 0.9, 30: 0.9, 31: 0.95, 32: 0.95 }),
      frame(0.1, { 0: -0.2, 23: 0.6, 24: 0.6, 29: 1.02, 30: 1.04, 31: 1.06, 32: 1.05 }),
      { t: 0.2, lm: null },
    ]));
    expect(s.outside![0]).toBe(0);
    expect(s.outside![1]).toBeCloseTo(0.06); // the head may leave the picture; the toes may not
    expect(Number.isNaN(s.outside![2])).toBe(true);
  });

  it("rising body gives rising signal", () => {
    const s = toSignals(video([frame(0, { 23: 0.5, 24: 0.5 }), frame(0.1, { 23: 0.4, 24: 0.4 })]));
    expect(s.hip[1]).toBeGreaterThan(s.hip[0]);
  });
});

describe("comY", () => {
  const pose = (y = 0.5) => Array.from({ length: 33 }, () => [0.5, y, 0, 0.9] as Landmark);

  it("is the common y when every point is at it", () => {
    expect(comY(pose(0.4))).toBeCloseTo(0.4, 9);
  });

  it("weighs the legs: raising knees, ankles and feet moves it by their share of the body mass", () => {
    const lm = pose(0.5);
    for (const i of [25, 26, 27, 28, 29, 30, 31, 32]) lm[i][1] -= 0.1;
    // de Leva male: per leg the thigh's centre (0.41 of hip → knee) moves 0.41 × 0.1, shank and foot 0.1.
    const share = 2 * (0.1416 * 0.4095 + 0.0433 + 0.0137);
    expect(0.5 - comY(lm)).toBeCloseTo(0.1 * share, 6);
  });

  it("falls back for points the pose doesn't have (the app's logged 13 points), and needs the legs", () => {
    const lm = pose(0.5);
    for (const i of [7, 8, 13, 14, 15, 16]) lm[i] = [0, 0, 0, 0];
    expect(comY(lm)).toBeCloseTo(0.5, 9);
    lm[25][3] = lm[26][3] = 0.1; // no knee visible
    expect(Number.isNaN(comY(lm))).toBe(true);
  });

  it("is in the signals, height-up", () => {
    const s = toSignals(video([frame(0, {}), frame(0.1, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, 0.4])))]));
    expect(s.com![1] - s.com![0]).toBeCloseTo(0.1 * 200, 6);
  });
});
