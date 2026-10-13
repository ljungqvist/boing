import { describe, expect, it } from "vitest";
import { findJumps } from "./jumps";
import { syntheticSignals } from "./synthetic";

describe("findJumps on synthetic CMJs", () => {
  for (const fps of [30, 60, 240]) {
    it(`measures a 30 cm jump at ${fps} fps within 1 cm`, () => {
      const jumps = findJumps(syntheticSignals({ fps, noise: 0.005, seed: fps }));
      expect(jumps).toHaveLength(1);
      const j = jumps[0];
      expect(j.hPrimary).toBeCloseTo(0.3, 1);
      expect(Math.abs(j.hPrimary - 0.3)).toBeLessThan(0.01);
      expect(Math.abs(j.hFlight - 0.3)).toBeLessThan(0.01);
      expect(Math.abs(j.tOff - 2)).toBeLessThan(0.01);
      expect(j.gImplied).toBeGreaterThan(9);
      expect(j.gImplied).toBeLessThan(10.6);
      expect(j.flags).toEqual([]);
    });
  }

  it("finds two jumps", () => {
    const s = syntheticSignals({ duration: 7, jumps: [{ tTakeoff: 2, height: 0.25 }, { tTakeoff: 5, height: 0.4 }] });
    const jumps = findJumps(s);
    expect(jumps.map((j) => Math.round(j.hPrimary * 100))).toEqual([25, 40]);
  });

  it("finds nothing while standing still", () => {
    expect(findJumps(syntheticSignals({ jumps: [], noise: 0.005 }))).toEqual([]);
  });

  it("flags 2x slow motion through the implied g", () => {
    const [j] = findJumps(syntheticSignals({ fps: 60, slowMotion: 2, duration: 8, jumps: [{ tTakeoff: 2, height: 0.3 }] }));
    expect(j.gImplied).toBeLessThan(3);
    expect(j.flags).toContain("g-implausible");
  });

  it("tolerates the scale distortion of a tilted camera", () => {
    // A camera tilted up made real jumps read g ≈ 6–8.5: body size looks too big
    // relative to the vertical motion.
    const s = syntheticSignals({ fps: 60 });
    s.bodyPx = s.bodyPx.map((b) => b / 0.65);
    const [j] = findJumps(s);
    expect(j.gImplied).toBeLessThan(7);
    expect(j.flags).not.toContain("g-implausible");
    expect(Math.abs(j.hPrimary - 0.3)).toBeLessThan(0.01);
  });

  it("flags a lifted foot without a jumping hip", () => {
    const s = syntheticSignals({ jumps: [] });
    // Toe mean rises 6 cm for 0.4 s (one foot lifted), hip stays put.
    s.t.forEach((t, i) => { if (t > 2 && t < 2.4) s.toe[i] += 0.06 * 300; });
    const jumps = findJumps(s);
    for (const j of jumps) expect(j.flags.length).toBeGreaterThan(0);
  });

  it("takes body size from upright posture, not from the crouch", () => {
    const s = syntheticSignals({ fps: 60 });
    // Body looks 30 % shorter during the countermovement dip (1.2–2.0 s).
    s.t.forEach((t, i) => { if (t > 1.2 && t < 2.0) s.bodyPx[i] *= 0.7; });
    const [j] = findJumps(s);
    expect(j.gImplied).toBeGreaterThan(9);
    expect(j.gImplied).toBeLessThan(10.6);
  });

  it("survives missing frames", () => {
    const s = syntheticSignals({ fps: 60, noise: 0.003 });
    for (let i = 0; i < s.t.length; i += 9) { s.toe[i] = NaN; s.hip[i] = NaN; }
    const [j] = findJumps(s);
    expect(Math.abs(j.hPrimary - 0.3)).toBeLessThan(0.01);
  });
});
