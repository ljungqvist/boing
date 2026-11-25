import { describe, expect, it } from "vitest";
import { type CameraLike, bestFps, describeCamera, fpsLabel } from "./camera";

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

describe("describeCamera", () => {
  const cam = (over: Partial<CameraLike> = {}): CameraLike => ({
    id: "0", position: "back", type: "wide-angle", isVirtualDevice: false, physicalDevices: [], hasTorch: true,
    supportedFPSRanges: [{ min: 15, max: 30 }, { min: 60, max: 60 }, { min: 15, max: 30 }], minZoom: 1, maxZoom: 8, focalLength: 5.4,
    getSupportedResolutions: (k) => (k === "video" ? [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }] : [{ width: 1280, height: 720 }]),
    ...over,
  });
  it("lists id, lens, flash, frame rates and sizes", () => {
    const d = describeCamera(cam(), true);
    expect(d.title).toBe("Back · id 0 · in use");
    expect(d.lines).toEqual([
      "wide-angle",
      "Flash yes · zoom 1–8× · 5.4 mm",
      "Frame rate up to 60 fps (ranges 15–30, 60)",
      "Largest video 3840×2160 · frames for analysis 1280×720",
    ]);
  });
  it("names the lenses of a combined camera and copes with missing data", () => {
    const d = describeCamera(
      cam({
        id: "2", position: "front", type: "triple", isVirtualDevice: true, hasTorch: false, focalLength: undefined,
        physicalDevices: [{ type: "ultra-wide-angle" }, { type: "wide-angle" }], supportedFPSRanges: [],
        getSupportedResolutions: () => { throw new Error("no"); },
      }),
      false,
    );
    expect(d.title).toBe("Front · id 2");
    expect(d.lines[0]).toBe("triple: ultra-wide-angle + wide-angle");
    expect(d.lines[1]).toBe("Flash no · zoom 1–8×");
    expect(d.lines[2]).toBe("Frame rate up to 0 fps (ranges –)");
    expect(d.lines[3]).toBe("Largest video ? · frames for analysis ?");
  });
});
