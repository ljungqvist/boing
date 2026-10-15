/** 240 fps reference video: vertex time of several trunk landmarks vs the hand-marked flight midpoint. */
import { readFileSync } from "node:fs";
import { fitQuadratic } from "../../src/analysis/fit";

const v = JSON.parse(readFileSync(process.argv[2] ?? "../boing-data/landmarks/own-20261014_020914.json", "utf8"));
const scale = v.timeScale;
const T = [7.325, 12.421, 17.661, 25.089, 31.239, 38.076, 46.484];
const F = [342, 392, 367, 397, 362, 378, 368];
const sets: Record<string, number[]> = {
  hip: [23, 24], shoulder: [11, 12], nose: [0], ear: [7, 8], eye: [2, 5], mouth: [9, 10], knee: [25, 26], ankle: [27, 28], heel: [29, 30], toe: [31, 32], wrist: [15, 16], elbow: [13, 14],
};
const H = v.height;
for (let k = 0; k < T.length; k++) {
  const t1 = T[k], t2 = T[k] + F[k] / 1000, mid = (t1 + t2) / 2;
  const margin = 0.03; // keep away from contact
  const fr = v.frames.map((f: any) => ({ t: f.t * scale, lm: f.lm })).filter((f: any) => f.lm && f.t > t1 + margin && f.t < t2 - margin);
  const parts: string[] = [];
  for (const [name, idx] of Object.entries(sets)) {
    const y = fr.map((f: any) => H - idx.reduce((s, i) => s + f.lm[i][1], 0) / idx.length * H);
    const q = fitQuadratic(fr.map((f: any) => f.t), y);
    parts.push(`${name} ${((q.vertex - mid) * 1000).toFixed(0)}ms/${q.rms.toFixed(1)}px/a${(-q.a).toFixed(0)}`);
  }
  console.log(`jump ${k + 1} T ${F[k]} ms (${(9.81 * (F[k] / 1000) ** 2 / 8 * 100).toFixed(1)} cm) n ${fr.length}: ${parts.join("  ")}`);
}
