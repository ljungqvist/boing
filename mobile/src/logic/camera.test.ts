import { describe, expect, it } from "vitest";
import { bestFps, fpsLabel, pickCamera } from "./camera";

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

describe("pickCamera", () => {
  const cam = (id: string, hasTorch: boolean, fps: number) => ({ id, hasTorch, supportedFPSRanges: [{ min: 15, max: fps }] });
  it("takes the default camera", () => {
    const all = [cam("0", true, 60), cam("2", false, 60), cam("4", false, 60)];
    expect(pickCamera(all, "2", false)?.id).toBe("2");
  });
  it("takes the lowest id when the default is missing or unknown", () => {
    const all = [cam("10", false, 30), cam("2", false, 30), cam("4", false, 30)];
    expect(pickCamera(all, undefined, false)?.id).toBe("2");
    expect(pickCamera(all, "9", false)?.id).toBe("2");
  });
  it("only considers cameras with a flash when the torch is wanted", () => {
    const all = [cam("0", false, 60), cam("2", true, 60)];
    expect(pickCamera(all, "0", true)?.id).toBe("2");
    expect(pickCamera(all, "0", false)?.id).toBe("0");
  });
  it("keeps all cameras when none has a flash", () => {
    expect(pickCamera([cam("0", false, 60), cam("1", false, 60)], "1", true)?.id).toBe("1");
  });
  it("drops cameras clearly slower than the fastest, also the default", () => {
    const all = [cam("0", true, 30), cam("2", true, 60), cam("3", true, 58)];
    expect(pickCamera(all, "0", false)?.id).toBe("2");
    expect(pickCamera(all, "3", false)?.id).toBe("3"); // 58 is close enough to 60
  });
  it("compares the fastest among the flash cameras when the torch is wanted", () => {
    const all = [cam("0", false, 120), cam("2", true, 30)];
    expect(pickCamera(all, "0", true)?.id).toBe("2");
    expect(pickCamera(all, "0", false)?.id).toBe("0");
  });
  it("finds nothing without cameras", () => {
    expect(pickCamera([], "0", false)).toBeUndefined();
  });
});
