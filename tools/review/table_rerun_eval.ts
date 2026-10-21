/** Table-session clips re-analysed on the computer with more or less pre-roll: heights vs the hand-marked truth. */
import { readFileSync } from "node:fs";
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { REJECT } from "../../mobile/src/logic/measure";
import { TABLE_TRUTH } from "./table_truth";

const R = "/Users/pl/code/boing-data/review/table_rerun";
for (const pre of ["0.95", "1.5", "2.5"]) {
  const parts: string[] = [];
  const errs: number[] = [];
  for (const [clip, tr] of Object.entries(TABLE_TRUTH)) {
    const k = clip.slice(13, 17);
    const d = JSON.parse(readFileSync(`${R}/${k}_${pre}/heavy_e1_p0.json`, "utf8"));
    const frames = d.windows[0].frames;
    const j = findJumps(toSignals({ width: d.width, height: d.height, fps: 60, frames }))
      .sort((a, b) => Math.abs(a.tOff - tr.off) - Math.abs(b.tOff - tr.off))[0];
    const hT = 9.81 * (tr.on - tr.off) ** 2 / 8;
    const rej = j.flags.some((f) => (REJECT as string[]).includes(f));
    if (!rej) errs.push((j.hPrimary - hT) * 100);
    parts.push(`${(hT * 100).toFixed(1)}→${(j.hPrimary * 100).toFixed(1)}${rej ? "✗" : ""} (${((j.tOff - tr.off) * 1000).toFixed(0)}/${((j.tOn - tr.on) * 1000).toFixed(0)})`);
  }
  const m = errs.reduce((a, b) => a + b, 0) / errs.length, sd = Math.sqrt(errs.reduce((a, b) => a + (b - m) ** 2, 0) / errs.length);
  console.log(`pre-roll ${pre} s: accepted ${errs.length}/7, error ${m >= 0 ? "+" : ""}${m.toFixed(1)} ± ${sd.toFixed(1)} | ${parts.join("  ")}`);
}
