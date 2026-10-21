import { readFileSync } from "node:fs";
import { fitQuadratic } from "../../src/analysis/fit";
import { comY, trunkY } from "./com";

const v = JSON.parse(readFileSync(process.argv[2] ?? "../boing-data/landmarks/own-20261014_020914.json", "utf8"));
const scale = v.timeScale, H = v.height;
const T = [7.325, 12.421, 17.661, 25.089, 31.239, 38.076, 46.484];
const F = [342, 392, 367, 397, 362, 378, 368];
const sig: Record<string, (lm: any) => number> = {
  hip: (lm) => (lm[23][1] + lm[24][1]) / 2, shoulder: (lm) => (lm[11][1] + lm[12][1]) / 2, trunk: trunkY, com: comY,
};
for (const margin of [0.03, 0.06]) {
  console.log(`margin ${margin * 1000} ms`);
  for (let k = 0; k < T.length; k++) {
    const t1 = T[k], t2 = T[k] + F[k] / 1000, midT = (t1 + t2) / 2;
    const fr = v.frames.map((f: any) => ({ t: f.t * scale, lm: f.lm })).filter((f: any) => f.lm && f.t > t1 + margin && f.t < t2 - margin);
    const parts = Object.entries(sig).map(([name, fn]) => {
      const q = fitQuadratic(fr.map((f: any) => f.t), fr.map((f: any) => H - fn(f.lm) * H));
      const hP = 9.81 / 2 * (q.vertex - t1) ** 2;
      return `${name} ${((q.vertex - midT) * 1000).toFixed(0).padStart(4)}ms rms ${q.rms.toFixed(1)} a ${(-q.a).toFixed(0)} hP ${(hP * 100).toFixed(1)}`;
    });
    console.log(`  j${k + 1} hF ${(9.81 * (F[k] / 1000) ** 2 / 8 * 100).toFixed(1)}: ${parts.join(" | ")}`);
  }
}
