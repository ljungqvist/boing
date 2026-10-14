/** Distribution of the asymmetry indicators in the simulation: drift jump (5) vs the others. */
import { readFileSync, readdirSync } from "node:fs";
import { findJumpsExp } from "./jumps_exp";
import { TRUTH_020914 } from "./simeval";

const dirs = process.argv.slice(2);
const rows: { drift: boolean; cfg: string; ratio: number; apex: number; shift: number; toeRms: number; err: number; flags: string }[] = [];
for (const dir of dirs) for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  d.windows.forEach((w: any, k: number) => {
    const t1 = TRUTH_020914.tOff[k], T = TRUTH_020914.flightMs[k] / 1000;
    const js = findJumpsExp({ width: d.width, height: d.height, fps: 0, frames: w.frames }, {});
    const j = js.filter((x) => Math.abs(x.tOff - t1) < 0.5).sort((a, b) => Math.abs(a.tOff - t1) - Math.abs(b.tOff - t1))[0];
    if (!j || j.rejected) return;
    rows.push({ drift: k === 4, cfg: f, ratio: j.hPrimary / j.hFlight, apex: j.apexOff / (j.tOn - j.tOff), shift: j.floorShift, toeRms: j.toeRmsRel, err: (j.hPrimary - 9.81 * T * T / 8) * 100, flags: j.flags.join(",") });
  });
}
const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
for (const [name, key] of [["hP/hF", "ratio"], ["apexOff/T", "apex"], ["floorShift", "shift"], ["toeRms", "toeRms"]] as const) {
  const ok = rows.filter((r) => !r.drift).map((r) => r[key] as number), dr = rows.filter((r) => r.drift).map((r) => r[key] as number);
  console.log(`${name.padEnd(10)} others n=${ok.length} p1 ${q(ok, 0.01).toFixed(3)} p50 ${q(ok, 0.5).toFixed(3)} p99 ${q(ok, 0.99).toFixed(3)} max ${Math.max(...ok).toFixed(3)} | drift n=${dr.length} min ${Math.min(...dr).toFixed(3)} p50 ${q(dr, 0.5).toFixed(3)} max ${Math.max(...dr).toFixed(3)}`);
}
// Which drift cases slip through a rule set?
const rule = (r: typeof rows[0]) => r.ratio > 1.2 || r.apex > 0.06;
console.log("drift caught by ratio>1.2 or apex>0.06:", rows.filter((r) => r.drift && rule(r)).length, "/", rows.filter((r) => r.drift).length,
  "| others falsely rejected:", rows.filter((r) => !r.drift && rule(r)).length, "/", rows.filter((r) => !r.drift).length);
for (const r of rows.filter((r) => r.drift && !rule(r))) console.log("  missed:", r.cfg, r.err.toFixed(1), r.ratio.toFixed(2), r.apex.toFixed(3), r.flags);
for (const r of rows.filter((r) => !r.drift && rule(r))) console.log("  false:", r.cfg, r.err.toFixed(1), r.ratio.toFixed(2), r.apex.toFixed(3), r.flags);
