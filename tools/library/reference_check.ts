/** Reference-only library jumps (device values: My Jump, contact mat, force plate) against findJumps. */
import { readFileSync } from "node:fs";
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { libPath, loadLibrary, poseOf } from "./library";
const lib = loadLibrary()!;
for (const j of lib.jumps.filter((x) => x.tags.includes("reference-only"))) {
  const v = poseOf(j)!;
  const raw = JSON.parse(readFileSync(libPath(j.pose![0].file), "utf8"));
  const ts = raw.timeScale ?? 1;
  const vid = { ...v, frames: v.frames.map((f) => ({ t: f.t * ts, lm: f.lm })) };
  const js = findJumps(toSignals(vid)).filter((x) => Math.abs(x.tOff - j.reference!.approxTakeoffT) < 1);
  for (const x of js) console.log(j.id, "ref", j.reference!.valueCm, "→ shown", (x.hPrimary * 100).toFixed(1), "rise", (x.hRise * 100).toFixed(1), "flight", (x.hFlight * 100).toFixed(1), x.flags.join(","));
}
