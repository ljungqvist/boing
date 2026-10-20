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
