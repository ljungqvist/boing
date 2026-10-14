import { describe, expect, it } from "vitest";
import { syntheticFrames } from "../../../src/analysis/synthetic";
import { accepted } from "./measure";
import { measureVideo, type Analyze } from "./video";

/** A fake decoder over synthetic frames (file timeline), recording each call. */
function fakeFile(o: Parameters<typeof syntheticFrames>[0]) {
  const v = syntheticFrames(o);
  const calls: { from: number; to: number; minInterval: number; n: number }[] = [];
  const analyze: Analyze = async ({ from, to, minInterval }, onProgress) => {
    let last = -Infinity;
    const frames = v.frames.filter((f) => {
      if (f.t < from || f.t > to || f.t - last < minInterval) return false;
      last = f.t;
      return true;
    });
    calls.push({ from, to, minInterval, n: frames.length });
    onProgress(1);
    return { frames, size: { width: v.width, height: v.height } };
  };
  const t = v.frames.map((f) => f.t);
  return { analyze, calls, duration: t[t.length - 1], fps: (t.length - 1) / t[t.length - 1] };
}

describe("measureVideo", () => {
  it("measures a 30 fps file in one pass", async () => {
    const f = fakeFile({ fps: 30, duration: 6, jumps: [{ tTakeoff: 2.5, height: 0.3 }], seed: 1 });
    const r = await measureVideo({ duration: f.duration, fps: f.fps, captureFps: 0 }, f.analyze);
    expect(f.calls).toHaveLength(1);
    expect(r.jumps).toHaveLength(1);
    expect(r.jumps[0].jump.hFlight).toBeCloseTo(0.3, 1);
    expect(r.jumps[0].refined).toBe(true);
  });

  it("finds jumps at 30 fps first, then measures every frame around them (240 fps)", async () => {
    const f = fakeFile({
      fps: 240, duration: 10, seed: 2,
      jumps: [{ tTakeoff: 2.5, height: 0.25 }, { tTakeoff: 7, height: 0.35 }],
    });
    const progress: number[] = [];
    const r = await measureVideo({ duration: f.duration, fps: f.fps, captureFps: 0 }, f.analyze, (p) => progress.push(p));
    expect(f.calls[0].n).toBeLessThan(400); // ~30 fps over 10 s
    expect(f.calls.slice(1).every((c) => c.minInterval === 0)).toBe(true);
    expect(r.jumps.filter((m) => accepted(m.jump)).map((m) => +m.jump.hFlight.toFixed(2))).toEqual([0.25, 0.35]);
    expect(r.jumps.every((m) => m.refined && m.fps > 200)).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("doesn't take a variable-frame-rate file for slow motion", async () => {
    // Recorded at up to 60 fps (metadata: capture 60), but averaging 35 fps.
    const f = fakeFile({ fps: 60, duration: 8, seed: 4, jumps: [{ tTakeoff: 3, height: 0.25 }] });
    const r = await measureVideo({ duration: f.duration, fps: 35, peakFps: 60, captureFps: 60 }, f.analyze);
    expect(r.timeScale).toBe(1);
    expect(r.jumps.filter((m) => accepted(m.jump)).map((m) => +m.jump.hFlight.toFixed(2))).toEqual([0.25]);
  });

  it("converts Android slow-motion files to real time", async () => {
    // 240 fps captured, stored at 30 fps: 8× slower on the file's timeline.
    const f = fakeFile({ fps: 30, duration: 40, slowMotion: 8, seed: 3, jumps: [{ tTakeoff: 2, height: 0.2 }] });
    const r = await measureVideo({ duration: f.duration, fps: f.fps, captureFps: 240 }, f.analyze);
    expect(r.timeScale).toBeCloseTo(0.125, 3);
    expect(r.jumps.filter((m) => accepted(m.jump))).toHaveLength(1);
    expect(r.jumps[0].jump.hFlight).toBeCloseTo(0.2, 1);
    expect(r.jumps[0].fps).toBeGreaterThan(200);
  });
});
