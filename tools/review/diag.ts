/** Drift/asymmetry diagnostics of accepted jumps, per landmark file. */
import { readFileSync } from "node:fs";
import { findJumpsExp, type ExpOptions } from "./jumps_exp";

const opts: ExpOptions = JSON.parse(process.env.OPTS ?? '{"clampEdges":true,"landFloor":"after"}');
console.log("file | tOff | hP | hF | ratio | apexOff/T | floorShift | scaleChange | frames | flags");
for (const path of process.argv.slice(2)) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  for (const j of findJumpsExp(v, opts)) {
    if (j.rejected) continue;
    const T = j.tOn - j.tOff;
    console.log(`${path.split("/").pop()!.replace(".json", "").padEnd(34)} ${j.tOff.toFixed(2).padStart(6)} ${(j.hPrimary * 100).toFixed(1).padStart(5)} ${(j.hFlight * 100).toFixed(1).padStart(5)} ${(j.hPrimary / j.hFlight).toFixed(2)} ${(j.apexOff / T).toFixed(3).padStart(6)} ${j.floorShift.toFixed(3).padStart(6)} ${j.scaleChange.toFixed(3).padStart(6)} ${String(j.airborneFrames).padStart(3)} ${j.flags.join(",")}`);
  }
}
