/**
 * Rules for jumps rejected as "unsteady points", on every library set. First guess (hips unsteady →
 * flight time) never fired: in the rejected 60 fps jumps the toes were the unsteady ones (feet pulled
 * up). The toe-plateau rule (edges along the hips) is what findJumps does since 2026-10-21; with it,
 * "today" here already includes it.
 */
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { REJECT } from "../../mobile/src/logic/measure";
import { findJumpsExp } from "../review/jumps_exp";
import { evaluateAll, summary, type Finder } from "./evaluate";

const POOR = 0.015;
const rule = (opts: { toeMax: number; requireEarlyApex: boolean }): Finder => (v) =>
  findJumps(toSignals(v)).map((j) => {
    let flags = j.flags;
    let h = j.hPrimary;
    const hipsOnly = j.hipRmsRel > POOR && j.toeRmsRel <= opts.toeMax;
    const early = j.hRise < j.hFlight; // apex before mid-flight
    if (flags.includes("poor-fit") && hipsOnly && (!opts.requireEarlyApex || early)) {
      flags = flags.filter((f) => f !== "poor-fit" && f !== "disagree" && f !== "inconsistent");
      h = j.hFlight;
    }
    return { ...j, flags, hPrimary: h, rejected: flags.some((f) => (REJECT as string[]).includes(f)) };
  });
/** Toe plateau (feet pulled up): only the toes fit poorly → edges from the hips (hipLeg), accepted if consistent. */
const plateau = (maxRatio: number): Finder => (v) => {
  const alt = findJumpsExp(v, { edges: "hipLeg" });
  return findJumps(toSignals(v)).map((j) => {
    const rej = { ...j, rejected: j.flags.some((f) => (REJECT as string[]).includes(f)) };
    if (!(j.flags.includes("poor-fit") && j.toeRmsRel > POOR && j.hipRmsRel <= POOR)) return rej;
    const a = alt.find((x) => Math.abs(x.tOff - j.tOff) < 0.15);
    if (!a) return rej;
    const ok = a.hRise / a.hFlight < maxRatio && a.hFlight / a.hRise < maxRatio
      && !a.flags.some((f) => ["not-parabola", "few-frames", "g-implausible", "out-of-view"].includes(f));
    return ok ? { ...a, hPrimary: Math.min(a.hRise, a.hFlight), flags: ["toe-plateau"], rejected: false } : rej;
  });
};
const today: Finder = (v) => findJumps(toSignals(v)).map((j) => ({ ...j, rejected: j.flags.some((f) => (REJECT as string[]).includes(f)) }));

const V: [string, Finder][] = [
  ["today", today],
  ["toe plateau → hipLeg if consistent (≤ 1.15)", plateau(1.15)],
  ["toe plateau → hipLeg if consistent (≤ 1.3)", plateau(1.3)],
];
for (const [n, f] of V) {
  console.log(n);
  for (const rs of evaluateAll(f)) console.log(`  ${rs[0]?.set.padEnd(52)} ${summary(rs)}`);
}
