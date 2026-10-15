import { describe, expect, it } from "vitest";
import { motionSummary, SampleBuffer, type Sample } from "./motion";

/** Accelerometer at 100 Hz for a phone leaning back by `tilt` degrees, from t = 0 to 3 s. */
const leaning = (tilt: number): Sample[] =>
  Array.from({ length: 300 }, (_, i) => [i / 100, 0, Math.cos((tilt * Math.PI) / 180), Math.sin((tilt * Math.PI) / 180)]);

describe("motionSummary", () => {
  it("reads how far the phone leans back", () => {
    expect(motionSummary(leaning(0), [], 1.5, 2)?.tiltDeg).toBe(0);
    expect(motionSummary(leaning(35), [], 1.5, 2)?.tiltDeg).toBe(35);
    expect(motionSummary(leaning(35), [], 1.5, 2)?.upsideDown).toBe(false);
  });

  it("sees the phone turn or get knocked during the jump", () => {
    const gyro: Sample[] = Array.from({ length: 300 }, (_, i) => [i / 100, 0, 0, i === 180 ? 0.2 : 0]);
    const acc = leaning(20);
    acc[190] = [1.9, 0, 1.4, 0.34];
    const m = motionSummary(acc, gyro, 1.5, 2)!;
    expect(m.turnMaxDegS).toBeCloseTo(11.5, 1);
    expect(m.shakeMaxG).toBeGreaterThan(0.4);
    // A still phone: nothing.
    expect(motionSummary(leaning(20), [], 1.5, 2)).toMatchObject({ turnMaxDegS: 0, shakeMaxG: 0 });
  });

  it("is null without samples", () => {
    expect(motionSummary([], [], 1, 2)).toBeNull();
  });
});

describe("SampleBuffer", () => {
  it("keeps the last seconds and cuts windows", () => {
    const b = new SampleBuffer(1);
    for (let i = 0; i <= 300; i++) b.add([i / 100, i, 0, 0]);
    expect(b.window(0, 10)[0][0]).toBe(2);
    expect(b.window(2.5, 2.6)).toHaveLength(11);
  });
});
