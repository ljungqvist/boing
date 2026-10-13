/**
 * Replay a session saved with "Save session" through the live JumpTracker,
 * and report timestamp problems. Usage: npx tsx tools/replay.ts <session.json>
 */
import { readFileSync } from "node:fs";
import { findJumps } from "../src/analysis/jumps";
import { toSignals } from "../src/analysis/signals";
import { JumpTracker } from "../src/analysis/tracker";
import type { PoseVideo } from "../src/analysis/types";

const s: PoseVideo & { meta?: Record<string, unknown> } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const t = s.frames.map((f) => f.t);
const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
const q = (p: number) => (gaps[Math.floor(p * (gaps.length - 1))] * 1000).toFixed(1);
console.log("meta", JSON.stringify(s.meta));
console.log(`${s.frames.length} frames, ${s.width}x${s.height}, t ${t[0]?.toFixed(3)} → ${t[t.length - 1]?.toFixed(3)} s`);
console.log(`frame gaps ms: p1 ${q(0.01)}  p50 ${q(0.5)}  p99 ${q(0.99)}  max ${q(1)}`);
console.log(`frames with a person: ${s.frames.filter((f) => f.lm).length}`);

const tracker = new JumpTracker();
console.log("\nlive tracker:");
for (const f of s.frames) {
  for (const j of tracker.push(f, s)) {
    console.log(`  t=${j.tOff.toFixed(2)}  ${(j.hPrimary * 100).toFixed(1)} / ${(j.hFlight * 100).toFixed(1)} cm  g ${j.gImplied.toFixed(1)}  ${j.flags.join(",")}`);
  }
}
console.log("\nwhole session at once:");
for (const j of findJumps(toSignals(s))) {
  console.log(`  t=${j.tOff.toFixed(2)}  ${(j.hPrimary * 100).toFixed(1)} / ${(j.hFlight * 100).toFixed(1)} cm  g ${j.gImplied.toFixed(1)}  ${j.flags.join(",")}`);
}
