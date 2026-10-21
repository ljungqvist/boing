/** The experimental finder with default options must reproduce findJumps on every landmark file. */
import { readFileSync, readdirSync } from "node:fs";
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { findJumpsExp } from "./jumps_exp";

const dir = "../boing-data/landmarks/";
let bad = 0, total = 0;
for (const f of readdirSync(dir)) {
  const v = JSON.parse(readFileSync(dir + f, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  const a = findJumps(toSignals(v)), b = findJumpsExp(v);
  total += a.length;
  if (a.length !== b.length) { console.log(f, "count", a.length, b.length); bad++; continue; }
  a.forEach((j, k) => {
    if (Math.abs(j.hPrimary - b[k].hPrimary) > 1e-9 || Math.abs(j.hFlight - b[k].hFlight) > 1e-9 || j.flags.join() !== b[k].flags.join()) { console.log(f, k, j.hPrimary, b[k].hPrimary, j.flags, b[k].flags); bad++; }
  });
}
console.log(`${total} jumps, ${bad} differences`);
