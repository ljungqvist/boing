/** A constant takeoff correction (the toe point leaves the floor early) on the library; see docs/accuracy-ideas.md. */
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { REJECT } from "../../mobile/src/logic/measure";
import { evaluateAll, summary, type Finder } from "./evaluate";
const shift = (ms: number): Finder => (v) => findJumps(toSignals(v)).map((j) => {
  const tOff = j.tOff + ms / 1000;
  const hR = 9.81 / 2 * (j.tApex - tOff) ** 2, hF = 9.81 * (j.tOn - tOff) ** 2 / 8;
  return { ...j, tOff, hRise: hR, hFlight: hF, hPrimary: Math.min(hR, hF), rejected: j.flags.some((f) => (REJECT as string[]).includes(f)) };
});
for (const ms of [0, 10, 15, 20]) {
  console.log(`takeoff +${ms} ms`);
  for (const rs of evaluateAll(shift(ms))) if (/native|sim 240→(30|60) fps sharp \(|blur 1\/30 \(2026-10-14|full rate|side, sim 240→60 fps sharp/.test(rs[0].set) && !/RTMPose/.test(rs[0].set)) {
    console.log(`  ${rs[0].set.padEnd(48)} ${summary(rs)}`);
  }
}
