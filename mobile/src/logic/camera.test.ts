import { describe, expect, it } from "vitest";
import { bestFps } from "./camera";

describe("bestFps", () => {
  it("takes the highest supported rate, at most 240", () => {
    expect(bestFps([{ min: 15, max: 30 }, { min: 60, max: 60 }])).toBe(60);
    expect(bestFps([{ min: 30, max: 480 }])).toBe(240);
    expect(bestFps([])).toBe(30);
  });
});
