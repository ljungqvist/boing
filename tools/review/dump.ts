/**
 * Per-frame dump of one jump: toe/heel/hip signals, airborne run, fits.
 * Usage: npx tsx tools/review/dump.ts <landmarks.json|session.json> [tFrom tTo] [--piece k] [--scale s]
 */
import { readFileSync } from "node:fs";
import { findJumps } from "../../src/analysis/jumps";
import { evalQuadratic } from "../../src/analysis/fit";
import { toSignals } from "../../src/analysis/signals";
import type { PoseVideo } from "../../src/analysis/types";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const piece = flag("--piece");
const scaleArg = flag("--scale");
let v: PoseVideo & { jumps?: any[]; start?: number } = JSON.parse(readFileSync(args[0], "utf8"));
let offset = 0;
if (piece !== undefined) {
  const r = v.jumps!.filter((j) => j.refined)[Number(piece)].refined;
  v = r; offset = r.start;
}
const scale = scaleArg ? Number(scaleArg) : (v as any).timeScale ?? 1;
for (const f of v.frames) f.t = f.t * scale + offset;
const tFrom = args[1] ? Number(args[1]) : -Infinity, tTo = args[2] ? Number(args[2]) : Infinity;
const s = toSignals(v);
const jumps = findJumps(s);
const H = v.height;
for (const j of jumps) {
  if (j.tOff < tFrom - 1 || j.tOff > tTo + 1) continue;
  console.log(`jump tOff ${j.tOff.toFixed(3)} tOn ${j.tOn.toFixed(3)} apex ${j.tApex.toFixed(3)}  hP ${(j.hPrimary*100).toFixed(1)} hF ${(j.hFlight*100).toFixed(1)} frames ${j.airborneFrames} g ${j.gImplied.toFixed(1)} hipRms ${(j.hipRmsRel*100).toFixed(2)}% toeRms ${(j.toeRmsRel*100).toFixed(2)}% flags ${j.flags}`);
  const d = j.debug;
  console.log(`  run i0 ${d.i0} (t ${s.t[d.i0].toFixed(3)}) i1 ${d.i1} (t ${s.t[d.i1].toFixed(3)}) floor ${d.floor.toFixed(1)} bodyPx ${d.bodyPx.toFixed(0)}`);
  console.log(`  toeFit a ${d.toeFit.a.toFixed(0)} vertex ${d.toeFit.vertex.toFixed(3)} rms ${d.toeFit.rms.toFixed(1)} | hipFit a ${d.hipFit.a.toFixed(0)} vertex ${d.hipFit.vertex.toFixed(3)} rms ${d.hipFit.rms.toFixed(1)}`);
  console.log("   t       toeL   toeR   toe-fl heelL  heelR  hip    hipFit  toeFit  vis(toeL,toeR)");
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] < j.tOff - 0.4 || s.t[i] > j.tOn + 0.4) continue;
    const lm = v.frames[i].lm;
    const up = (k: number) => lm ? (H - lm[k][1] * H).toFixed(1).padStart(6) : "   -  ";
    const mark = i >= d.i0 && i <= d.i1 ? "*" : " ";
    const air = s.t[i] >= j.tOff && s.t[i] <= j.tOn ? "A" : " ";
    console.log(`${mark}${air}${s.t[i].toFixed(3)} ${up(31)} ${up(32)} ${(s.toe[i] - d.floor).toFixed(1).padStart(6)} ${up(29)} ${up(30)} ${s.hip[i].toFixed(1).padStart(6)} ${evalQuadratic(d.hipFit, s.t[i]).toFixed(1).padStart(7)} ${evalQuadratic(d.toeFit, s.t[i]).toFixed(1).padStart(7)}  ${lm ? lm[31][3].toFixed(2) + "," + lm[32][3].toFixed(2) : ""}`);
  }
}
