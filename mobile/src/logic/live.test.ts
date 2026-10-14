import { describe, expect, it } from "vitest";
import { syntheticFrames } from "../../../src/analysis/synthetic";
import type { PoseFrame } from "../../../src/analysis/types";
import { LiveController, type LiveDeps } from "./live";
import { accepted } from "./measure";
import type { Measured } from "./video";

/**
 * A fake camera: the "recording" is the scene at 240 fps; the live analysis only sees
 * 15 fps of it. Clip files are named by their start time on the frame clock.
 */
function setup(opts: { recordFails?: boolean; analyzeFails?: boolean; startLag?: number; liveFps?: number } = {}) {
  const jumps = [{ tTakeoff: 4, height: 0.3 }, { tTakeoff: 9, height: 0.22 }];
  const scene = syntheticFrames({ fps: 240, duration: 14, jumps, seed: 5 });
  const size = { width: scene.width, height: scene.height };
  let now = 0;
  const clips: { start: number; stopped: boolean; deleted: boolean }[] = [];
  const analysed: { from: number; to: number }[] = [];
  const deps: LiveDeps = {
    async startClip() {
      if (opts.recordFails) throw new Error("no recorder");
      // Like CameraX: one recording at a time.
      if (clips.some((x) => !x.stopped)) throw new Error("A recording is already in progress");
      const c = { start: now + (opts.startLag ?? 0), stopped: false, deleted: false };
      clips.push(c);
      return { stop: async () => { c.stopped = true; return `clip@${c.start}`; } };
    },
    async analyzeClip(path, from, to) {
      if (opts.analyzeFails) throw new Error("decoder failed");
      analysed.push({ from, to });
      const start = Number(path.split("@")[1]);
      const frames: PoseFrame[] = scene.frames
        .filter((f) => f.t - start >= from && f.t - start <= to)
        .map((f) => ({ t: f.t - start, lm: f.lm }));
      return { frames, size };
    },
    deleteClip(path) {
      const c = clips.find((x) => `clip@${x.start}` === path);
      if (c) c.deleted = true;
    },
  };
  const results: Measured[] = [];
  let measuring = 0;
  const live = new LiveController(deps, {
    status: () => {},
    measuring: () => measuring++,
    result: (m) => results.push(m),
  });
  async function run() {
    let last = -Infinity;
    for (const f of scene.frames) {
      if (f.t - last < 1 / (opts.liveFps ?? 15)) continue;
      last = f.t;
      now = f.t;
      live.push(f, size);
      await Promise.resolve(); // let clip starts settle between frames
      await Promise.resolve();
    }
    await live.stop();
  }
  return { live, run, results, clips, analysed, measuring: () => measuring };
}

describe("LiveController", () => {
  it("measures each live jump again from every recorded frame", async () => {
    const s = setup();
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok).toHaveLength(2);
    expect(ok.every((m) => m.refined && !m.approximate && m.fps > 200)).toBe(true);
    expect(ok[0].jump.hFlight).toBeCloseTo(0.3, 1);
    expect(ok[1].jump.hFlight).toBeCloseTo(0.22, 1);
    expect(s.measuring()).toBe(2);
    // Every clip is stopped and deleted in the end.
    expect(s.clips.every((c) => c.stopped && c.deleted)).toBe(true);
    // Only the stretch around each jump is analysed.
    expect(s.analysed.every((w) => w.to - w.from < 3)).toBe(true);
  });

  it("replaces long clips without jumps, never recording two at once", async () => {
    const s = setup();
    await s.run();
    // 14 s with jumps at 4 and 9 s: clips end after each jump; none runs twice at a time.
    expect(s.clips.length).toBeGreaterThanOrEqual(3);
    expect(s.clips.every((c) => c.stopped && c.deleted)).toBe(true);
  });

  it("tolerates an inexact clip start time", async () => {
    const s = setup({ startLag: 0.2 });
    await s.run();
    expect(s.results.filter((m) => accepted(m.jump) && m.refined)).toHaveLength(2);
  });

  it("falls back to the live result, marked approximate, when re-measuring fails", async () => {
    const s = setup({ analyzeFails: true, liveFps: 30 });
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok).toHaveLength(2);
    expect(ok.every((m) => !m.refined && m.approximate)).toBe(true);
  });

  it("works without recording (live results only)", async () => {
    const s = setup({ recordFails: true, liveFps: 30 });
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok).toHaveLength(2);
    expect(ok.every((m) => !m.refined && !m.approximate)).toBe(true);
  });
});
