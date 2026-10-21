/** Do the quality indicators predict the error? (simulation, drift jump excluded) */
import { readFileSync, readdirSync } from "node:fs";
import { findJumpsExp } from "./jumps_exp";
import { TRUTH_020914 } from "./simeval";

const rows: number[][] = [];
for (const dir of process.argv.slice(2)) for (const f of readdirSync(dir).filter((x) => /_e(8|4)_/.test(x))) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  d.windows.forEach((w: any, k: number) => {
    if (k === 4) return;
    const t1 = TRUTH_020914.tOff[k], T = TRUTH_020914.flightMs[k] / 1000;
    const j = findJumpsExp({ width: d.width, height: d.height, fps: 0, frames: w.frames }, {}).filter((x) => Math.abs(x.tOff - t1) < 0.5)[0];
    if (!j || j.rejected) return;
    rows.push([(j.hPrimary - 9.81 * T * T / 8) * 100, j.toeRmsRel * 100, j.hipRmsRel * 100, j.hPrimary / j.hFlight, j.apexOff / (j.tOn - j.tOff), (j.tOff - t1) * 1000]);
  });
}
const names = ["err", "toeRms%", "hipRms%", "hP/hF", "apexOff/T", "dOff ms"];
const corr = (a: number[], b: number[]) => { const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
for (let c = 1; c < names.length; c++) console.log(`corr(err, ${names[c]}) = ${corr(rows.map((r) => r[0]), rows.map((r) => r[c])).toFixed(2)}`);
const big = rows.filter((r) => r[0] > 8);
console.log(`errors > 8 cm: ${big.length}/${rows.length}`);
for (const r of big) console.log("  " + r.map((x, i) => `${names[i]} ${x.toFixed(2)}`).join("  "));
const tr = rows.filter((r) => r[1] > 1.5);
console.log(`toeRms > 1.5 %: ${tr.length}, their errors: ${tr.map((r) => r[0].toFixed(1)).join(" ")}`);
