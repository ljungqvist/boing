import { describe, expect, it } from "vitest";
import { frameToView } from "./overlay";

const frame = { width: 720, height: 1280 }; // 9:16

describe("frameToView", () => {
  it("puts the frame centre in the view centre", () => {
    expect(frameToView(0.5, 0.5, frame, { width: 400, height: 860 }, false)).toEqual({ x: 200, y: 430 });
  });

  it("fills a tall phone screen in height (3:4 preview, 9:16 frame)", () => {
    const view = { width: 400, height: 860 };
    expect(frameToView(0.5, 0, frame, view, false).y).toBeCloseTo(0);
    expect(frameToView(0.5, 1, frame, view, false).y).toBeCloseTo(860);
    // The frame is 9:16 of the 860-high picture: 483.75 wide, centred.
    expect(frameToView(0, 0.5, frame, view, false).x).toBeCloseTo(200 - 483.75 / 2);
  });

  it("on a tablet the frame is narrower than the screen (9:16 inside a 3:4 picture)", () => {
    const view = { width: 800, height: 1280 };
    // Picture 1280 high and 960 wide (sides cropped); the frame is 720 wide, centred.
    expect(frameToView(0.5, 0, frame, view, false).y).toBeCloseTo(0);
    expect(frameToView(1, 0.5, frame, view, false).x).toBeCloseTo(760);
  });

  it("on a landscape-shaped view the picture is cropped in height", () => {
    const view = { width: 900, height: 900 };
    // Picture 1200 high (fills the width), the frame its full height.
    expect(frameToView(0.5, 0, frame, view, false).y).toBeCloseTo(450 - 600);
  });

  it("mirrors x for the front camera", () => {
    const view = { width: 400, height: 860 };
    const a = frameToView(0.2, 0.3, frame, view, false);
    const b = frameToView(0.8, 0.3, frame, view, true);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
  });
});
