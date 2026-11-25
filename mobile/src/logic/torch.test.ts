import { describe, expect, it } from "vitest";
import { DARK_FOR_S, DarkDetector, meanBrightness, nextTorchMode, torchModeOf } from "./torch";

describe("torch mode", () => {
  it("cycles off, auto, on", () => {
    expect(nextTorchMode("off")).toBe("auto");
    expect(nextTorchMode("auto")).toBe("on");
    expect(nextTorchMode("on")).toBe("off");
  });
  it("reads unknown saved values as off", () => {
    expect(torchModeOf(undefined)).toBe("off");
    expect(torchModeOf("flash")).toBe("off");
    expect(torchModeOf("auto")).toBe("auto");
    expect(torchModeOf("on")).toBe("on");
  });
});

describe("meanBrightness", () => {
  const picture = (w: number, h: number, stride: number, v: number) => new Uint8Array(stride * h).fill(v);
  it("is 0 for black and 1 for white", () => {
    expect(meanBrightness(picture(64, 48, 256, 0), 64, 48, 256)).toBe(0);
    expect(meanBrightness(picture(64, 48, 256, 255), 64, 48, 256)).toBe(1);
  });
  it("skips the padding at the end of each row and ignores alpha", () => {
    const w = 8, h = 8, stride = 48;
    const px = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([51, 51, 51, 255], y * stride + x * 4);
    expect(meanBrightness(px, w, h, stride, 64)).toBeCloseTo(0.2, 5);
  });
  it("is NaN without a picture", () => {
    expect(meanBrightness(new Uint8Array(0), 0, 0, 0)).toBeNaN();
    expect(meanBrightness(new Uint8Array(10), 64, 48, 10)).toBeNaN();
  });
});

describe("DarkDetector", () => {
  it("turns on after the picture was dark for a while, and stays on", () => {
    const d = new DarkDetector();
    expect(d.update(0.05, 0)).toBe(false);
    expect(d.update(0.05, DARK_FOR_S - 0.1)).toBe(false);
    expect(d.update(0.05, DARK_FOR_S)).toBe(true);
    expect(d.update(0.6, DARK_FOR_S + 1)).toBe(true); // the light itself brightens the picture
  });
  it("starts over when the picture gets bright in between", () => {
    const d = new DarkDetector();
    d.update(0.05, 0);
    d.update(0.5, 1);
    expect(d.update(0.05, 2)).toBe(false);
    expect(d.update(0.05, 2 + DARK_FOR_S)).toBe(true);
  });
  it("ignores unreadable pictures and can be reset", () => {
    const d = new DarkDetector();
    d.update(NaN, 0);
    d.update(0.01, 1);
    expect(d.update(0.01, 1 + DARK_FOR_S)).toBe(true);
    d.reset();
    expect(d.update(0.01, 10)).toBe(false);
  });
});
