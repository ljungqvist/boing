/** Two option sets side by side on landmark files: accepted jumps, hP and hF. */
import { readFileSync } from "node:fs";
import { findJumpsExp } from "./jumps_exp";

const A = JSON.parse(process.env.A ?? "{}"), B = JSON.parse(process.env.B ?? '{"edges":"knee","kneeWindow":0.15}');
console.log("file | tOff | A hP/hF | B hP/hF | ΔhP");
for (const path of process.argv.slice(2)) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  const ja = findJumpsExp(v, A).filter((j) => !j.rejected), jb = findJumpsExp(v, B);
  for (const a of ja) {
    const b = jb.find((x) => Math.abs(x.tOff - a.tOff) < 0.2);
    const bs = b ? `${(b.hPrimary * 100).toFixed(1)}/${(b.hFlight * 100).toFixed(1)}${b.rejected ? " REJ" : ""}` : "–";
    console.log(`${path.split("/").pop()!.replace(".json", "").padEnd(32)} ${a.tOff.toFixed(2).padStart(6)} ${(a.hPrimary * 100).toFixed(1).padStart(5)}/${(a.hFlight * 100).toFixed(1).padEnd(5)} ${bs.padEnd(12)} ${b ? ((b.hPrimary - a.hPrimary) * 100).toFixed(1) : ""}`);
  }
}
