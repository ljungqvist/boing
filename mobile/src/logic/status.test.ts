import { describe, expect, it } from "vitest";
import type { Landmark, PoseFrame } from "../../../src/analysis/types";
import { liveStatus } from "./status";

/** A standing person: nose at 0.2, hips at 0.5, heels/toes at `feet` (image y, down). */
function person(feet = 0.9, visible = 0.9): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0, visible]);
  lm[0] = [0.5, 0.2, 0, 0.9];
  for (const i of [29, 30, 31, 32]) lm[i] = [0.5, feet, 0, visible];
  return lm;
}

const standing = (n: number): PoseFrame[] => Array.from({ length: n }, (_, i) => ({ t: i / 30, lm: person() }));

describe("liveStatus", () => {
  it("asks to find the person, the feet, then says ready", () => {
    expect(liveStatus([], null, 30, true).text).toBe("Looking for you…");
    expect(liveStatus(standing(10), person(0.9, 0.2), 30, true).text).toMatch(/Feet not visible/);
    expect(liveStatus(standing(10), person(), 30, true)).toEqual({ text: "Ready", tone: "ready" });
  });

  it("shows when the person is in the air", () => {
    expect(liveStatus(standing(30), person(0.8), 30, true).tone).toBe("air");
  });

  it("warns about a slow analysis only after warming up", () => {
    expect(liveStatus(standing(10), person(), 8, true).tone).toBe("adjust");
    expect(liveStatus(standing(10), person(), 8, false).tone).toBe("ready");
  });

  it("never mentions jump technique", () => {
    const texts = [liveStatus([], null, 30, true), liveStatus(standing(10), person(0.9, 0.2), 30, true)].map((s) => s.text);
    for (const t of texts) expect(t).not.toMatch(/knee|leg|arm|land|straight|bend/i);
  });
});
