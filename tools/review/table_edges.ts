/** Takeoff/landing of the jumps in imported native-app sessions, in clip time (for contact sheets). */
import { readFileSync, readdirSync } from "node:fs";
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const v = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const log = v.log;
  const j = findJumps(toSignals(v)).sort((a, b) => Math.abs(a.tOff - log.tOff) - Math.abs(b.tOff - log.tOff))[0];
  console.log([log.clip, (j.tOff - log.clipStart).toFixed(3), (j.tOn - log.clipStart).toFixed(3), (j.hPrimary * 100).toFixed(1), (j.hFlight * 100).toFixed(1), j.airborneFrames, j.flags.join(",") || "-"].join(" "));
}
