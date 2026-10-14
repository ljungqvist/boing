/** hP (apex fit) vs posture-corrected flight height, with the landing drop. */
import { readFileSync } from "node:fs";
import { findJumpsExp, type ExpOptions } from "./jumps_exp";

const opts: ExpOptions = JSON.parse(process.env.OPTS ?? '{"clampEdges":true,"landFloor":"after"}');
console.log("file | tOff | hP | hF | hCorr | dLand cm | apexOff ms | flags");
for (const path of process.argv.slice(2)) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  for (const j of findJumpsExp(v, opts)) {
    if (j.rejected) continue;
    console.log(`${path.split("/").pop()!.replace(".json", "").padEnd(34)} ${j.tOff.toFixed(2).padStart(6)} ${(j.hPfit * 100).toFixed(1).padStart(5)} ${(j.hFlight * 100).toFixed(1).padStart(5)} ${(j.hCorr * 100).toFixed(1).padStart(5)} ${(j.dLand * 100).toFixed(1).padStart(5)} ${(j.apexOff * 1000).toFixed(0).padStart(4)} ${j.flags.join(",")}`);
  }
}
