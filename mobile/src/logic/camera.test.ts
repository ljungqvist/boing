import { describe, expect, it } from "vitest";
import { bestFps, fpsLabel } from "./camera";

describe("bestFps", () => {
  it("takes the highest supported rate, at most 240", () => {
    expect(bestFps([{ min: 15, max: 30 }, { min: 60, max: 60 }])).toBe(60);
    expect(bestFps([{ min: 30, max: 480 }])).toBe(240);
    expect(bestFps([])).toBe(30);
  });
});

describe("fpsLabel", () => {
  it("warns below 40 fps", () => {
    expect(fpsLabel(30)).toEqual({ text: "30 fps · accuracy may be off below 40 fps", low: true });
    expect(fpsLabel(39.4)?.low).toBe(true);
    expect(fpsLabel(39.6)).toEqual({ text: "40 fps", low: false });
    expect(fpsLabel(60)).toEqual({ text: "60 fps", low: false });
  });
  it("shows nothing for an unknown rate", () => {
    expect(fpsLabel(0)).toBeNull();
    expect(fpsLabel(undefined)).toBeNull();
    expect(fpsLabel(NaN)).toBeNull();
  });
});
