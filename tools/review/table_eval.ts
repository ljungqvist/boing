/** Option sets of the experimental finder on the table session, against the hand-marked flight times. */
import { readFileSync, readdirSync } from "node:fs";
import { findJumpsExp, type ExpOptions } from "./jumps_exp";
import { TABLE_TRUTH } from "./table_truth";

const dir = process.argv[2];
const sets: Record<string, ExpOptions> = JSON.parse(process.env.SETS ?? '{"base":{}}');
for (const [name, o] of Object.entries(sets)) {
  const parts: string[] = [];
  const errs: number[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const v = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const truth = TABLE_TRUTH[v.log.clip];
    if (!truth) continue;
    const t1 = truth.off + v.log.clipStart, t2 = truth.on + v.log.clipStart;
    const hT = 9.81 * (t2 - t1) ** 2 / 8;
    const j = findJumpsExp(v, o).sort((a, b) => Math.abs(a.tOff - t1) - Math.abs(b.tOff - t1))[0];
    const e = (j.hPrimary - hT) * 100;
    if (!j.rejected) errs.push(e);
    parts.push(`${(hT * 100).toFixed(1)}→${(j.hPrimary * 100).toFixed(1)}${j.rejected ? "✗" : ""} (${((j.tOff - t1) * 1000).toFixed(0)}/${((j.tOn - t2) * 1000).toFixed(0)})`);
  }
  const m = errs.reduce((a, b) => a + b, 0) / errs.length, sd = Math.sqrt(errs.reduce((a, b) => a + (b - m) ** 2, 0) / errs.length);
  console.log(`${name.padEnd(14)} accepted ${errs.length}/7  error ${m >= 0 ? "+" : ""}${m.toFixed(1)} ± ${sd.toFixed(1)} cm  | ${parts.join("  ")}`);
}
