/** Blends of takeoff→apex (hRise) and flight-time height on the library (front sets). */
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { REJECT } from "../../mobile/src/logic/measure";
import { evaluateAll, summary, type Finder } from "./evaluate";
const mk = (f: (r: number, fl: number) => number): Finder => (v) => findJumps(toSignals(v, { anyOfPair: true })).map((j) => ({
  ...j, hPrimary: f(j.hRise, j.hFlight), rejected: j.flags.some((x) => (REJECT as string[]).includes(x)) }));
const V: [string, Finder][] = [
  ["min (today)", mk((r, f) => Math.min(r, f))],
  ["mean", mk((r, f) => (r + f) / 2)],
  ["min of rise and mean", mk((r, f) => Math.min(r, (r + f) / 2))],
  ["0.7 rise + 0.3 flight, capped", mk((r, f) => Math.min(0.7 * r + 0.3 * f, f))],
  ["rise only", mk((r) => r)],
];
for (const [n, f] of V) { console.log(n); for (const rs of evaluateAll(f)) if (!rs[0]?.set.startsWith("side")) console.log(`  ${rs[0]?.set.padEnd(48)} ${summary(rs)}`); }
