import { describe, expect, it } from "vitest";
import { blindColor, screenFacesDown } from "./blind";

const tilt = (deg: number) => ({ x: 0, y: Math.cos((deg * Math.PI) / 180), z: Math.sin((deg * Math.PI) / 180) });

describe("screenFacesDown", () => {
  it("is on when the screen points below the horizon and off when it points up", () => {
    expect(screenFacesDown(tilt(-20), false)).toBe(true);
    expect(screenFacesDown(tilt(20), true)).toBe(false);
    expect(screenFacesDown({ x: 0, y: 0, z: -9.81 }, false)).toBe(true); // face down on a table
  });

  it("doesn't flicker for a phone standing about upright", () => {
    expect(screenFacesDown(tilt(-1), false)).toBe(false);
    expect(screenFacesDown(tilt(1), true)).toBe(true);
  });

  it("keeps the last answer without a reading", () => {
    expect(screenFacesDown({ x: 0, y: 0, z: 0 }, true)).toBe(true);
  });
});

describe("blindColor", () => {
  it("is green when ready, orange in the air or while measuring, red otherwise", () => {
    expect(blindColor("ready", false)).toBe("green");
    expect(blindColor("air", false)).toBe("orange");
    expect(blindColor("idle", true)).toBe("orange");
    expect(blindColor("ready", true)).toBe("orange");
    expect(blindColor("adjust", false)).toBe("red");
    expect(blindColor("idle", false)).toBe("red");
    expect(blindColor("error", false)).toBe("red");
  });
});
