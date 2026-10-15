/** Refined pieces of saved web sessions, with and without regular frame times. */
import { readFileSync, readdirSync } from "node:fs";
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { dejitter } from "./dejitter";

const dir = "../boing-data/sessions/";
for (const f of readdirSync(dir)) {
  const s = JSON.parse(readFileSync(dir + f, "utf8"));
  for (const j of s.jumps ?? []) {
    if (!j.refined) continue;
    const r = j.refined;
    const show = (frames: any[]) => findJumps(toSignals({ ...r, frames }))
      .filter((x) => Math.abs(x.tOff + r.start - j.tOff) < 0.5)
      .map((x) => `${(x.hPrimary * 100).toFixed(1)}/${(x.hFlight * 100).toFixed(1)} apex-mid ${((x.tApex - (x.tOff + x.tOn) / 2) * 1000).toFixed(0)}ms ${x.flags}`).join(" | ");
    const tj = dejitter(r.frames.map((x: any) => x.t));
    console.log(f, j.tOff.toFixed(2), "file times:", show(r.frames), " || regular:", show(r.frames.map((x: any, i: number) => ({ ...x, t: tj[i] }))));
  }
}
