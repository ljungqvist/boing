import { describe, expect, it } from "vitest";
import { compactPose, describeLog, diagnosticsReport, POSE_POINTS, poseReport } from "./diagnostics";

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

  it("shows the camera's exposure and frame rates when they were read", () => {
    const e = { tOff: 1, hLive: 0.3, framesLive: 9, h: 0.28, frames: 14, fps: 30, ms: 800, offset: 0.01,
      camera: { fps: 30, maxFps: 60, exposureS: 1 / 120, iso: 640 } };
    expect(describeLog(e)).toBe("t 1.0 s · live 30.0 cm (9 fr) → 28.0 cm (14 fr, 30 fps, 800 ms, offset 0.01 s)"
      + " · exposure 1/120 s, ISO 640, camera 30 fps (max 60)");
    // Android may not report exposure: only the frame rates.
    expect(describeLog({ ...e, camera: { fps: 30, maxFps: 30, exposureS: 0, iso: 0 } })).toContain("· camera 30 fps (max 30)");
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

describe("pose data", () => {
  const lm = Array.from({ length: 33 }, (_, i) => [i / 100, 0.5 + i / 1000, 0, 0.987654] as [number, number, number, number]);
  const frames = [{ t: 100.5, lm }, { t: 100.5166666, lm: null }];
  const pose = compactPose(frames, { width: 540, height: 960 });

  it("keeps time, x, y and visibility of the points the analysis uses", () => {
    expect(pose.t0).toBe(100.5);
    const [f0, f1] = pose.frames as number[][];
    expect(f0).toHaveLength(1 + 3 * POSE_POINTS.length);
    expect(f0.slice(0, 4)).toEqual([0, 0, 0.5, 0.99]);
    expect(f1).toEqual([0.0167]);
  });

  it("stays out of the readable diagnostics and goes into its own report", () => {
    const entry = { ...rejected, pose };
    expect(diagnosticsReport({}, [entry])).not.toContain("points");
    const report = JSON.parse(poseReport({ device: "x" }, [entry, { tOff: 1, hLive: 0.2 }]));
    expect(report).toMatchObject({ boing: "pose", version: 1, device: "x" });
    expect(report.jumps).toHaveLength(1);
    expect(report.jumps[0].pose.width).toBe(540);
  });
});

describe("motion", () => {
  const motion = { tiltDeg: 31.6, rollDeg: 1, upsideDown: false, turnMaxDegS: 2.4, shakeMaxG: 0.031, acc: [[1, 0, 0.85, 0.52]], gyro: [] };
  const entry = { tOff: 1, hLive: 0.3, framesLive: 9, h: 0.28, frames: 14, fps: 30, ms: 800, offset: 0.01, motion };

  it("adds the phone's tilt and movement to the line", () => {
    expect(describeLog(entry)).toBe(
      "t 1.0 s · live 30.0 cm (9 fr) → 28.0 cm (14 fr, 30 fps, 800 ms, offset 0.01 s) · phone 32° back, turn ≤ 2°/s, shake 0.03 g",
    );
  });

  it("keeps the summary but not the samples in the readable report", () => {
    const raw = JSON.parse(diagnosticsReport({}, [entry]).split("\n").pop()!);
    expect(raw[0].motion).toEqual({ tiltDeg: 31.6, rollDeg: 1, upsideDown: false, turnMaxDegS: 2.4, shakeMaxG: 0.031 });
  });
});
