import { describe, expect, it } from "vitest";
import { describeLog, diagnosticsReport } from "./diagnostics";

const rejected = {
  tOff: 1394416.04, hLive: 0.269, framesLive: 10, error: "rejected", ms: 11224,
  h: 0.312, frames: 7, g: 3.8, offset: 0.05, flags: ["few-frames", "g-implausible"],
  analysed: 75, withPose: 70, fps: 29.97, video: { width: 720, height: 1280, rotation: 270, fps: 30 },
};

describe("describeLog", () => {
  it("says why a re-measured jump was rejected, and what the recording looked like", () => {
    expect(describeLog(rejected)).toBe(
      "t 1394416.0 s · live 26.9 cm (10 fr) · not re-measured: rejected (11224 ms)" +
      " · re-measured 31.2 cm (7 fr, g 3.8, offset 0.05 s): too short, speed doesn't match gravity" +
      " · 75 frames at 30 fps, 70 with a person · video 720×1280, rotation 270°, 30 fps",
    );
  });

  it("lists the movements found when none matched the live jump", () => {
    const e = { tOff: 3, hLive: 0.2, framesLive: 9, error: "no-match", ms: 900, analysed: 70, withPose: 0, fps: 30, found: [] };
    expect(describeLog(e)).toContain("movements found: none");
    expect(describeLog(e)).toContain("0 with a person");
  });

  it("keeps the short line for live-only movements and successful re-measurements", () => {
    expect(describeLog({ tOff: 1, hLive: 0.3, framesLive: 5, reason: "not-refinable-or-before-clip" }))
      .toBe("t 1.0 s · live 30.0 cm (5 fr) · not re-measured: not-refinable-or-before-clip");
    expect(describeLog({ tOff: 1, hLive: 0.3, framesLive: 9, h: 0.28, frames: 14, fps: 30, ms: 800, offset: 0.01 }))
      .toBe("t 1.0 s · live 30.0 cm (9 fr) → 28.0 cm (14 fr, 30 fps, 800 ms, offset 0.01 s)");
  });

  it("shows recording errors as they are", () => {
    expect(describeLog({ error: "recording: busy" })).toBe("recording: busy");
  });
});

describe("diagnosticsReport", () => {
  it("has the context, one line per entry and the raw entries", () => {
    const text = diagnosticsReport({ device: "Samsung SM-S918B (android 15)", camera: "front" }, [rejected]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Boing diagnostics");
    expect(lines).toContain("device: Samsung SM-S918B (android 15)");
    expect(lines).toContain(describeLog(rejected));
    expect(JSON.parse(lines[lines.length - 1])).toEqual([rejected]);
  });
});
