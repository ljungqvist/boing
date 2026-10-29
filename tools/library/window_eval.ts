/**
 * Shorter re-measurement windows on the library (docs/evaluation/2026-10-29-measuring-speed.md).
 * The app analyses every frame from 1.1 s before takeoff to 0.9 s after landing (BEFORE + PAD,
 * AFTER + PAD in mobile/src/logic/measure.ts). Fewer frames would measure faster, if the heights hold.
 *
 * Each jump found today is cut to the window around it and measured again. Approximate: the pose was
 * computed with the longer history (VIDEO-mode tracking starts earlier than a shorter window would),
 * and the app's own logged poses (native sets) are already cut at 1.1 / 0.9 s.
 *
 *   npx tsx tools/library/window_eval.ts
 */
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import type { PoseVideo } from "../../src/analysis/types";
import { REJECT } from "../../mobile/src/logic/measure";
import { evaluateAll, summary, todayFinder, type Finder, type Found } from "./evaluate";

interface Window {
  name: string;
  /** Seconds kept before takeoff and after landing. */
  before: number;
  after: number;
  /** Before this many seconds ahead of takeoff, keep only every other frame. */
  halfRateBefore?: number;
}

const WINDOWS: Window[] = [
  { name: "today 1.1 / 0.9 s", before: 1.1, after: 0.9 },
  { name: "0.9 / 0.7 s (PAD 0.1)", before: 0.9, after: 0.7 },
  { name: "0.8 / 0.6 s (no PAD)", before: 0.8, after: 0.6 },
  { name: "0.7 / 0.5 s", before: 0.7, after: 0.5 },
  { name: "1.1 / 0.9 s, half rate before −0.3 s", before: 1.1, after: 0.9, halfRateBefore: 0.3 },
  { name: "0.9 / 0.7 s, half rate before −0.3 s", before: 0.9, after: 0.7, halfRateBefore: 0.3 },
];

const toFound = (j: ReturnType<typeof findJumps>[number]): Found =>
  ({ ...j, rejected: j.flags.some((f) => (REJECT as string[]).includes(f)) });

function windowed(w: Window): Finder {
  return (v: PoseVideo) => {
    const out: Found[] = [];
    for (const anchor of todayFinder(v)) {
      const from = anchor.tOff - w.before, to = anchor.tOn + w.after;
      let k = 0;
      const frames = v.frames.filter((f) => {
        if (f.t < from || f.t > to) return false;
        if (w.halfRateBefore !== undefined && f.t < anchor.tOff - w.halfRateBefore) return k++ % 2 === 0;
        return true;
      });
      const found = findJumps(toSignals({ ...v, frames }));
      const near = found.reduce<typeof found[number] | null>(
        (b, j) => (Math.abs(j.tOff - anchor.tOff) < 0.5 && (!b || Math.abs(j.tOff - anchor.tOff) < Math.abs(b.tOff - anchor.tOff)) ? j : b), null);
      if (near) out.push(toFound(near));
    }
    return out;
  };
}

for (const w of WINDOWS) {
  console.log(w.name);
  for (const rs of evaluateAll(windowed(w))) if (rs.length) console.log(`  ${rs[0].set.padEnd(60)} ${summary(rs)}`);
}
