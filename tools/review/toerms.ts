import { readFileSync } from "node:fs";
import { findJumpsExp } from "./jumps_exp";
const xs: [number, string][] = [];
for (const path of process.argv.slice(2)) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  for (const j of findJumpsExp(v, {})) if (!j.rejected) xs.push([j.toeRmsRel * 100, `${path.split("/").pop()} ${j.tOff.toFixed(1)} hP ${(j.hPrimary * 100).toFixed(1)} hipRms ${(j.hipRmsRel * 100).toFixed(2)}`]);
}
xs.sort((a, b) => b[0] - a[0]);
for (const [r, s] of xs.slice(0, 15)) console.log(r.toFixed(2), s);
console.log("n", xs.length, "median", xs[xs.length >> 1][0].toFixed(2));
