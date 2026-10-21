import { describe, expect, it } from "vitest";
import type { Jump } from "../../../src/analysis/jumps";
import { accepted, closestJump, frameRate, jumpWindows, refinable, summarize, timeScaleOf, uniqueJumps } from "./measure";

const jump = (tOff: number, tOn = tOff + 0.4, flags: Jump["flags"] = []) => ({ tOff, tOn, flags }) as Jump;

describe("closestJump", () => {
  it("takes the jump with the nearest takeoff within 0.5 s", () => {
    expect(closestJump([jump(1), jump(3.3), jump(2.9)], 3)?.tOff).toBe(2.9);
    expect(closestJump([jump(1)], 3)).toBeNull();
  });
});

describe("refinable", () => {
  it("accepts jumps rejected only for too few frames", () => {
    expect(refinable(jump(0, 0.4, ["few-frames"]))).toBe(true);
    expect(refinable(jump(0, 0.4, ["few-frames", "not-parabola"]))).toBe(false);
    expect(refinable(jump(0, 0.4, ["camera-moved"]))).toBe(true);
  });

  it("re-measures jumps the live frame rate couldn't measure cleanly", () => {
    // Noisy points or an apex too late at ~20 fps may be fine from every recorded frame.
    expect(refinable(jump(0, 0.4, ["inconsistent"]))).toBe(true);
    expect(refinable(jump(0, 0.4, ["poor-fit", "few-frames"]))).toBe(true);
    expect(refinable(jump(0, 0.4, ["out-of-view"]))).toBe(false);
  });
});

describe("accepted", () => {
  it("rejects unsteady points but only notes a moved camera", () => {
    expect(accepted(jump(0, 0.4, ["poor-fit"]))).toBe(false);
    expect(accepted(jump(0, 0.4, ["camera-moved", "disagree"]))).toBe(true);
  });
});

describe("timeScaleOf", () => {
  it("is playback / capture fps for slow motion", () => {
    expect(timeScaleOf(240, 30)).toBeCloseTo(0.125);
    expect(timeScaleOf(0, 30)).toBe(1);
    expect(timeScaleOf(30, 30)).toBe(1);
  });

  it("uses frame times when given", () => {
    const times = Array.from({ length: 100 }, (_, i) => i / 30);
    expect(timeScaleOf(240, 30, times)).toBeCloseTo(0.125);
    expect(timeScaleOf(60, 60, times.map((t) => t / 2))).toBe(1);
  });
});

describe("jumpWindows", () => {
  it("pads and merges overlapping windows", () => {
    expect(jumpWindows([jump(5), jump(1), jump(1.8)], 1, 0.5)).toEqual([
      { from: 0, to: 2.7 },
      { from: 4, to: 5.9 },
    ]);
  });
});

describe("uniqueJumps", () => {
  it("keeps one jump per takeoff", () => {
    expect(uniqueJumps([jump(2), jump(1), jump(2.1)]).map((j) => j.tOff)).toEqual([1, 2]);
  });
});

describe("summarize / frameRate", () => {
  it("summarises heights", () => {
    expect(summarize([0.2, 0.3])).toEqual({ count: 2, best: 0.3, average: 0.25 });
    expect(summarize([]).count).toBe(0);
  });

  it("measures the frame rate", () => {
    expect(frameRate([{ t: 0 }, { t: 0.5 }, { t: 1 }])).toBe(2);
    expect(frameRate([{ t: 0 }])).toBe(0);
  });
});
