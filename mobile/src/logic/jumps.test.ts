import { describe, expect, it } from "vitest";
import { entriesForClip, uniqueId } from "./jumps";

describe("jumps", () => {
  it("makes ids unique within a second", () => {
    expect(uniqueId("2026-10-27_191228", () => false)).toBe("2026-10-27_191228");
    const taken = new Set(["a", "a-2"]);
    expect(uniqueId("a", (id) => taken.has(id))).toBe("a-3");
  });

  it("picks the entries of one clip", () => {
    const logs = [{ clip: "a.mp4", h: 0.4 }, { error: "stop recording" }, { clip: "b.mp4" }, { clip: "a.mp4", h: 0.5 }];
    expect(entriesForClip(logs, "a.mp4").map((e) => e.h)).toEqual([0.4, 0.5]);
    expect(entriesForClip(logs, "c.mp4")).toEqual([]);
  });
});
