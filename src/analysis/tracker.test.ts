import { describe, expect, it } from "vitest";
import { syntheticFrames } from "./synthetic";
import { JumpTracker } from "./tracker";
import type { Jump } from "./jumps";

function run(frames: ReturnType<typeof syntheticFrames>) {
  const tracker = new JumpTracker();
  const emitted: Jump[] = [];
  for (const f of frames.frames) emitted.push(...tracker.push(f, frames));
  return emitted;
}

describe("JumpTracker", () => {
  it("emits each jump exactly once, after landing", () => {
    const frames = syntheticFrames({
      fps: 30, duration: 12, noise: 0.003,
      jumps: [{ tTakeoff: 2, height: 0.25 }, { tTakeoff: 6, height: 0.35 }, { tTakeoff: 10, height: 0.3 }],
    });
    const jumps = run(frames);
    expect(jumps.map((j) => Math.round(j.hPrimary * 100))).toEqual([25, 35, 30]);
  });

  it("emits nothing while standing", () => {
    expect(run(syntheticFrames({ duration: 10, jumps: [], noise: 0.005 }))).toEqual([]);
  });

  it("waits until the landing has settled", () => {
    const frames = syntheticFrames({ fps: 60, duration: 6, jumps: [{ tTakeoff: 2, height: 0.3 }] });
    const tracker = new JumpTracker({ settleSeconds: 0.8 });
    let emittedAt = NaN;
    for (const f of frames.frames) if (tracker.push(f, frames).length) emittedAt = f.t;
    const landing = 2 + 2 * Math.sqrt(2 * 9.81 * 0.3) / 9.81;
    expect(emittedAt).toBeGreaterThan(landing + 0.8);
    expect(emittedAt).toBeLessThan(landing + 0.8 + 0.3);
  });

  it("starts over when time goes backwards (video restarted)", () => {
    const frames = syntheticFrames({ duration: 5, jumps: [{ tTakeoff: 2, height: 0.3 }] });
    const tracker = new JumpTracker();
    let n = 0;
    for (let pass = 0; pass < 2; pass++) for (const f of frames.frames) n += tracker.push(f, frames).length;
    expect(n).toBe(2);
  });
});
