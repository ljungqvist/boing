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

  for (const fps of [30, 60]) {
    it(`ignores the toe point creeping up before takeoff and after landing (${fps} fps)`, () => {
      // Seen with the lite/full pose models: the toe point rises ~5 % of body height in the push-off.
      const jumps = findJumps(syntheticSignals({ fps, noise: 0.005, seed: fps + 1, toeCreep: 0.08 }));
      expect(jumps).toHaveLength(1);
      const j = jumps[0];
      expect(Math.abs(j.hPrimary - 0.3)).toBeLessThan(0.015);
      expect(Math.abs(j.hFlight - 0.3)).toBeLessThan(0.015);
      expect(Math.abs(j.tOff - 2)).toBeLessThan(0.015);
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
    expect(j.flags).toEqual([]);
  });

  it("flags a jump where the person was lost in much of the flight", () => {
    // Standing too close: the pose model loses the person around the apex.
    const s = syntheticSignals({ fps: 60, noise: 0.003 });
    s.t.forEach((t, i) => { if (t > 2.1 && t < 2.3) { s.toe[i] = NaN; s.hip[i] = NaN; } });
    const [j] = findJumps(s);
    expect(j.flags).toContain("out-of-view");
  });

  it("flags hips or feet outside the picture around the jump", () => {
    const s = syntheticSignals({ fps: 60, noise: 0.003 });
    s.outside = s.t.map((t) => (t > 2.15 && t < 2.3 ? 0.08 : 0));
    expect(findJumps(s)[0].flags).toContain("out-of-view");
    // Touching the edge is fine.
    s.outside = s.t.map((t) => (t > 2.15 && t < 2.3 ? 0.01 : 0));
    expect(findJumps(s)[0].flags).toEqual([]);
  });

  it("flags takeoff→apex and flight-time heights that can't be the same flight", () => {
    // The hip apex 0.15 s late relative to the feet: ≈ 0.75 m vs 0.3 m.
    const s = syntheticSignals({ fps: 60, noise: 0.003 });
    const lag = 9;
    s.hip = s.hip.map((_, i) => s.hip[Math.max(0, i - lag)]);
    const [j] = findJumps(s);
    expect(j.hRise / j.hFlight).toBeGreaterThan(2);
    expect(j.flags).toContain("inconsistent");
  });

  it("flags a highest point too late for the landing (moving towards the camera in the air)", () => {
    // A floor-level camera sees the hips rise when the person comes closer: model it as an extra
    // upward drift of the hips after takeoff. 0.4 m/s puts the apex ≈ 40 ms late.
    const drift = (v: number) => {
      const s = syntheticSignals({ fps: 30, noise: 0.003 });
      s.hip = s.hip.map((y, i) => y + Math.max(0, s.t[i] - 2) * v * 300);
      return findJumps(s)[0];
    };
    const moved = drift(0.4);
    expect(moved.hRise / moved.hFlight).toBeGreaterThan(1.2);
    expect(moved.flags).toContain("inconsistent");
    // A little drift stays within the noise allowance.
    expect(drift(0.1).flags).not.toContain("inconsistent");
  });

  it("takes the edges along the hips when the feet are pulled up in the air (toe plateau)", () => {
    // A 30 cm jump; the feet tuck 25 cm in the air (ramps of 60 ms after takeoff and before landing):
    // the toes no longer fly a parabola, the hips still do.
    const s = syntheticSignals({ fps: 60, noise: 0.002 });
    const T = 2 * Math.sqrt((2 * 0.3) / 9.81);
    s.toe = s.toe.map((y, i) => {
      const x = s.t[i] - 2;
      if (x <= 0 || x >= T) return y;
      return y + 0.25 * 300 * Math.min(1, x / 0.06, (T - x) / 0.06);
    });
    const [j] = findJumps(s);
    expect(j.toeRmsRel).toBeGreaterThan(0.015);
    expect(j.flags).toContain("toe-plateau");
    expect(j.flags).not.toContain("poor-fit");
    expect(Math.abs(j.hFlight - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(j.hPrimary - 0.3)).toBeLessThan(0.03);
  });

  it("shows at most the flight-time height (a late apex can't make the jump higher)", () => {
    const drift = (v: number) => {
      const s = syntheticSignals({ fps: 30, noise: 0.003 });
      s.hip = s.hip.map((y, i) => y + Math.max(0, s.t[i] - 2) * v * 300);
      return findJumps(s)[0];
    };
    const j = drift(0.2);
    expect(j.hRise).toBeGreaterThan(1.05 * j.hFlight);
    expect(j.flags).not.toContain("inconsistent");
    expect(j.hPrimary).toBe(j.hFlight);
    // Without drift the takeoff→apex height is shown as it is.
    const still = drift(0);
    expect(still.hPrimary).toBe(Math.min(still.hRise, still.hFlight));
  });
});
