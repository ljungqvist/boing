import { describe, expect, it } from "vitest";
import { toSignals } from "./signals";
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

  it("rising body gives rising signal", () => {
    const s = toSignals(video([frame(0, { 23: 0.5, 24: 0.5 }), frame(0.1, { 23: 0.4, 24: 0.4 })]));
    expect(s.hip[1]).toBeGreaterThan(s.hip[0]);
  });
});
