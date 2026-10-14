/** Accepted jumps (current rules) that new rules would reject, over landmark files and session pieces. */
import { readFileSync } from "node:fs";
import { findJumpsExp } from "./jumps_exp";

const RATIO = Number(process.env.RATIO ?? 1.2), APEX = Number(process.env.APEX ?? 0.06);
let total = 0;
for (const path of process.argv.slice(2)) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  for (const j of findJumpsExp(v, {})) {
    if (j.rejected) continue;
    total++;
    const why = [];
    if (j.hPrimary > RATIO * j.hFlight) why.push(`hP/hF ${(j.hPrimary / j.hFlight).toFixed(2)}`);
    if (j.apexOff > APEX * (j.tOn - j.tOff)) why.push(`apex +${(j.apexOff * 1000).toFixed(0)} ms (${(j.apexOff / (j.tOn - j.tOff)).toFixed(3)} T)`);
    if (j.flags.includes("poor-fit")) why.push(`poor-fit (toe ${(j.toeRmsRel * 100).toFixed(1)} %, hip ${(j.hipRmsRel * 100).toFixed(1)} %)`);
    if (why.length) console.log(`${path.split("/").pop()} t ${j.tOff.toFixed(2)} hP ${(j.hPrimary * 100).toFixed(1)} hF ${(j.hFlight * 100).toFixed(1)}: ${why.join(", ")}`);
  }
}
console.log(`${total} accepted jumps checked`);
