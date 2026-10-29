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
function setup(opts: {
  recordFails?: boolean; analyzeFails?: boolean; startLag?: number; liveFps?: number;
  /** The recording's clock runs this much slower around each takeoff (a wrong time base). */
  clipStretch?: number;
  /** In the recording, the hips drift up this fast (m/s) after takeoff: moving towards a floor-level camera. */
  clipDrift?: number;
  jumps?: { tTakeoff: number; height: number }[];
  duration?: number;
  /** Seconds (frame clock) each result takes to be read out. */
  readout?: number;
} = {}) {
  const jumps = opts.jumps ?? [{ tTakeoff: 4, height: 0.3 }, { tTakeoff: 9, height: 0.22 }];
  const scene = syntheticFrames({ fps: 240, duration: opts.duration ?? 14, jumps, seed: 5 });
  const size = { width: scene.width, height: scene.height };
  let now = 0;
  const clips: { start: number; stopped: boolean; deleted: boolean; hasJumps?: boolean }[] = [];
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
      const k = opts.clipStretch ?? 1;
      const takeoff = jumps.map((j) => j.tTakeoff).find((t) => t - start > from && t - start < to) ?? 0;
      const frames: PoseFrame[] = scene.frames
        .filter((f) => f.t - start >= from && f.t - start <= to)
        .map((f) => ({ t: takeoff + (f.t - takeoff) * k - start, lm: drifted(f, takeoff) }));
      return { frames, size, video: { width: 720, height: 1280, rotation: 270, fps: 30 }, timing: { poseMs: 900, delegate: "GPU" } };
    },
    deleteClip(path, hasJumps) {
      const c = clips.find((x) => `clip@${x.start}` === path);
      if (c) Object.assign(c, { deleted: true, hasJumps });
    },
    // A still phone leaning back 30°, read at 100 Hz.
    camera: () => ({ fps: 30, maxFps: 60, exposureS: 0.01, iso: 400 }),
    motion: (from, to) => ({
      acc: Array.from({ length: Math.round((to - from) * 100) }, (_, i) => [from + i / 100, 0, Math.cos(Math.PI / 6), 0.5] as [number, number, number, number]),
      gyro: [],
    }),
  };
  // 300 px per metre in syntheticFrames.
  const drifted = (f: PoseFrame, takeoff: number) => {
    const v = opts.clipDrift ?? 0;
    if (!v || !f.lm || f.t < takeoff) return f.lm;
    const up = (v * 300 * (f.t - takeoff)) / scene.height;
    return f.lm.map((p, i) => (i === 23 || i === 24 ? [p[0], p[1] - up, p[2], p[3]] : p) as typeof p);
  };
  const results: Measured[] = [];
  const pendingAtResult: number[] = [];
  const logs: Record<string, unknown>[] = [];
  let measuring = 0;
  const paused: boolean[] = [];
  const statuses = new Set<string>();
  const live = new LiveController(deps, {
    status: (st) => statuses.add(st.text),
    paused: (on) => paused.push(on),
    measuring: () => measuring++,
    result: async (m) => {
      results.push(m);
      pendingAtResult.push(live.pending);
      const until = now + (opts.readout ?? 0);
      while (now < until && !ended) await Promise.resolve();
    },
    log: (e) => logs.push(e),
  });
  /** The scene is over: nothing is read out any more. */
  let ended = false;
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
    ended = true;
    await live.stop();
  }
  return { live, run, results, clips, analysed, logs, pendingAtResult, paused, statuses, now: () => now, measuring: () => measuring };
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
    // The analysed frames go into the log, for offline analysis.
    const pose = s.logs.filter((e) => e.pose).map((e) => e.pose as { frames: unknown[] });
    expect(pose).toHaveLength(2);
    expect(pose.every((p) => p.frames.length > 100)).toBe(true);
    // With the phone's tilt, and the clip it came from (kept when debugging).
    const measured = s.logs.filter((e) => e.pose);
    expect(measured.every((e) => (e.motion as { tiltDeg: number }).tiltDeg === 30 && typeof e.clip === "string")).toBe(true);
    // And the camera's exposure (motion blur of the feet).
    expect(measured.every((e) => (e.camera as { exposureS: number }).exposureS === 0.01)).toBe(true);
    // And where the time went: waiting for the recording, then analysing it.
    expect(measured.every((e) => (e.timing as { delegate: string }).delegate === "GPU")).toBe(true);
    expect(measured.every((e) => typeof e.waitMs === "number" && (e.totalMs as number) >= (e.waitMs as number))).toBe(true);
    expect(s.clips.filter((c) => c.hasJumps)).toHaveLength(2);
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

  it("doesn't replace the clip just before a jump while someone is in the picture", async () => {
    // Jumping every ~17 s (after hearing the last height): a clip without jumps used to be replaced
    // after 15 s, i.e. right in the next countermovement, and the jump couldn't be re-measured.
    const s = setup({ jumps: [{ tTakeoff: 4, height: 0.25 }, { tTakeoff: 21, height: 0.25 }], duration: 25 });
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok).toHaveLength(2);
    expect(ok.every((m) => m.refined)).toBe(true);
  });

  it("still replaces a clip without jumps after a minute in the picture", async () => {
    const s = setup({ jumps: [], duration: 70 });
    await s.run();
    expect(s.clips).toHaveLength(2);
    expect(s.clips[1].start).toBeGreaterThan(60);
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

  it("logs why a re-measured jump was rejected, with the recorded file's facts", async () => {
    // A recording whose clock runs 1.6× slow: its jumps imply g ≈ 3.8 m/s² and are rejected.
    const s = setup({ clipStretch: 1.6, liveFps: 30 });
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok).toHaveLength(2);
    expect(ok.every((m) => !m.refined && m.approximate)).toBe(true);
    const rejected = s.logs.filter((e) => e.error === "rejected");
    expect(rejected).toHaveLength(2);
    for (const e of rejected) {
      expect(e.flags).toContain("g-implausible");
      expect(e.g).toBeLessThan(4);
      expect(e.video).toMatchObject({ rotation: 270 });
      expect(e.withPose).toBe(e.analysed);
      expect(e.gLive).toBeGreaterThan(8);
    }
  });

  it("doesn't re-measure a live jump that is far too long in the air to be one", async () => {
    // ≈ 1.1 s in the air: a false alarm (someone walking out of the picture), not a jump.
    const s = setup({ jumps: [{ tTakeoff: 4, height: 1.4 }], liveFps: 30 });
    await s.run();
    const long = s.logs.find((e) => (e.hLive as number) > 1);
    expect(long).toMatchObject({ refined: false, reason: "not-refinable-or-before-clip" });
    expect(s.results.find((m) => m.jump.hPrimary > 1)?.refined).toBe(false);
  });

  it("works without recording (live results only)", async () => {
    const s = setup({ recordFails: true, liveFps: 30 });
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok).toHaveLength(2);
    expect(ok.every((m) => !m.refined && !m.approximate)).toBe(true);
  });

  it("doesn't show the live height when re-measuring finds the movement unmeasurable", async () => {
    // In the recording the hips' highest point comes too late for the landing (the person moved
    // towards the camera): the live analysis, with fewer frames, would show a height anyway.
    const s = setup({ clipDrift: 0.5, liveFps: 30 });
    await s.run();
    expect(s.results).toHaveLength(2);
    expect(s.results.every((m) => m.refined && !accepted(m.jump) && m.jump.flags.includes("inconsistent"))).toBe(true);
    expect(s.results.some((m) => m.approximate)).toBe(false);
  });

  it("measures one jump at a time: no live analysis and no recording until its height is out", async () => {
    // Measuring takes until 9 s here. The jump at 6.5 s comes while the first is being measured: it
    // isn't seen (one height at a time, no confusion which jump it belongs to). The one at 11 s is.
    const s = setup({ jumps: [{ tTakeoff: 4, height: 0.3 }, { tTakeoff: 6.5, height: 0.25 }, { tTakeoff: 11, height: 0.22 }] });
    const deps = (s.live as unknown as { deps: LiveDeps }).deps;
    const analyse = deps.analyzeClip.bind(deps);
    deps.analyzeClip = async (...a) => {
      while (s.now() < 9) await Promise.resolve();
      return analyse(...a);
    };
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok.map((m) => Math.round(m.jump.tOff))).toEqual([4, 11]);
    expect(ok.every((m) => m.refined && !m.approximate)).toBe(true);
    expect(ok[1].jump.hFlight).toBeCloseTo(0.22, 1);
    expect(s.paused).toEqual([true, false, true, false]);
    expect(s.statuses).toContain("Measuring · not ready");
    // Nothing recorded while measuring: the next clip starts after it.
    expect(s.clips[1].start).toBeGreaterThanOrEqual(9);
  });

  it("doesn't see a jump made while the height is read out", async () => {
    // Measuring is quick here, but reading out the height takes 3 s: the jump at 6.8 s comes then.
    const s = setup({ jumps: [{ tTakeoff: 4, height: 0.3 }, { tTakeoff: 6.8, height: 0.25 }, { tTakeoff: 11, height: 0.22 }], readout: 3 });
    await s.run();
    const ok = s.results.filter((m) => accepted(m.jump));
    expect(ok.map((m) => Math.round(m.jump.tOff))).toEqual([4, 11]);
    expect(ok.every((m) => m.refined)).toBe(true);
  });

  it("is no longer pending when a result arrives", async () => {
    const s = setup();
    await s.run();
    expect(s.pendingAtResult).toEqual([0, 0]);
  });
});
