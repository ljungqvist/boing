import { describe, expect, it } from "vitest";
import { fromDetect, LANDMARKS, toFrames } from "./pose";

const pose = (base: number) => Array.from({ length: LANDMARKS * 4 }, (_, i) => base + i);

describe("fromDetect", () => {
  it("reads time, size and 33 landmarks", () => {
    const { frame, size } = fromDetect([1.5, 720, 1280, ...pose(0)]);
    expect(frame.t).toBe(1.5);
    expect(size).toEqual({ width: 720, height: 1280 });
    expect(frame.lm).toHaveLength(33);
    expect(frame.lm![1]).toEqual([4, 5, 6, 7]);
    expect(frame.lm![32]).toEqual([128, 129, 130, 131]);
  });

  it("has no landmarks when no person was found", () => {
    expect(fromDetect([2, 720, 1280]).frame.lm).toBeNull();
  });
});

describe("toFrames", () => {
  it("splits the flat array per frame and scales time", () => {
    const frames = toFrames(
      { times: [1, 2], found: [false, true], landmarks: [...pose(0), ...pose(1000)] },
      0.125, 10,
    );
    expect(frames.map((f) => f.t)).toEqual([10.125, 10.25]);
    expect(frames[0].lm).toBeNull();
    expect(frames[1].lm![0]).toEqual([1000, 1001, 1002, 1003]);
  });
});
