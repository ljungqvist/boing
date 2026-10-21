/** A constant landing correction (the toe point lands late) against the centre-of-mass landing, on the library. */
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { REJECT } from "../../mobile/src/logic/measure";
import { evaluateAll, expFinder, summary, type Finder } from "./evaluate";
const shift = (ms: number): Finder => (v) => findJumps(toSignals(v)).map((j) => {
  const tOn = j.tOn - ms / 1000, hF = 9.81 * (tOn - j.tOff) ** 2 / 8;
  return { ...j, tOn, hFlight: hF, hPrimary: Math.min(j.hRise, hF), rejected: j.flags.some((f) => (REJECT as string[]).includes(f)) };
});
const V: [string, Finder][] = [["landing −20 ms", shift(20)], ["landing −30 ms", shift(30)],
  ["joint line w0.15 (centre of mass)", expFinder({ edges: "comHinge", comGround: "joint", comEdges: "landing" })]];
for (const [n, f] of V) { console.log(n); for (const rs of evaluateAll(f)) if (!/RTMPose/.test(rs[0].set) && /native|sim 240→(30|60) fps sharp|blur 1\/30 \(2026-10-14|full rate/.test(rs[0].set)) console.log(`  ${rs[0].set.padEnd(48)} ${summary(rs)}`); }
