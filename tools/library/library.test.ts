/**
 * Accuracy regression on the local jump library. Skipped where the library isn't present (CI, other
 * machines): it lives in ~/code/boing-data/library, never in git.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { librarySets, runSet, todayFinder } from "./evaluate";
import { libPath, loadLibrary } from "./library";

const lib = loadLibrary();

describe.skipIf(!lib)("jump library", () => {
  it("has every file it refers to", () => {
    for (const j of lib!.jumps) {
      for (const c of j.clips) expect(existsSync(libPath(c.file)), c.file).toBe(true);
      for (const p of j.pose ?? []) expect(existsSync(libPath(p.file)), p.file).toBe(true);
    }
  });

  it("keeps today's accuracy on the native sessions (front view)", () => {
    // Bounds a little outside the 2026-10-20 numbers (30 fps: 9/10, +2.0 ± 2.1, worst +5.4;
    // 60 fps: 9/13, +0.9 ± 1.5, worst +3.5); a change that crosses them needs a look.
    const bounds: Record<string, { accepted: number; mean: number; worst: number }> = {
      "front, native 30 fps (2026-10-19)": { accepted: 9, mean: 2.5, worst: 6 },
      "front, native 60 fps (2026-10-15)": { accepted: 9, mean: 1.5, worst: 4.5 },
    };
    for (const s of librarySets().filter((x) => bounds[x.name])) {
      const ok = runSet(s, todayFinder).filter((r) => r.found && !r.rejected);
      const e = ok.map((r) => (r.h - r.truth) * 100);
      const b = bounds[s.name];
      expect(ok.length, s.name).toBeGreaterThanOrEqual(b.accepted);
      expect(e.reduce((a, x) => a + x, 0) / e.length, s.name).toBeLessThan(b.mean);
      expect(Math.max(...e.map(Math.abs)), s.name).toBeLessThan(b.worst);
    }
  });
});
