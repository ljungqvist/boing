/** 240 fps: does the foot's pointing (ankle above toe, heel above toe) peak at takeoff / touchdown? */
import { readFileSync } from "node:fs";

const v = JSON.parse(readFileSync(process.argv[2] ?? "../boing-data/landmarks/own-20261014_020914.json", "utf8"));
const sc = v.timeScale ?? 1, H = v.height;
const T = [7.325, 12.421, 17.661, 25.089, 31.239, 38.076, 46.484];
const F = [342, 392, 367, 397, 362, 378, 368];
const fr = v.frames.map((f: any) => ({ t: f.t * sc, lm: f.lm })).filter((f: any) => f.lm);
for (const [name, fn] of [
  ["ankle-toe", (l: any) => ((l[31][1] + l[32][1]) - (l[27][1] + l[28][1])) / 2 * H],
  ["heel-toe", (l: any) => ((l[31][1] + l[32][1]) - (l[29][1] + l[30][1])) / 2 * H],
  ["hip-toe", (l: any) => ((l[31][1] + l[32][1]) - (l[23][1] + l[24][1])) / 2 * H],
] as const) {
  const offs: number[] = [], ons: number[] = [];
  for (let k = 0; k < T.length; k++) {
    const t1 = T[k], t2 = t1 + F[k] / 1000;
    // Max within ±80 ms of each edge, smoothed over 5 frames.
    const peak = (tc: number) => {
      const w = fr.filter((f: any) => Math.abs(f.t - tc) < 0.1);
      const y = w.map((f: any) => fn(f.lm));
      let best = -1, bi = 0;
      for (let i = 2; i < y.length - 2; i++) { const m = (y[i - 2] + y[i - 1] + y[i] + y[i + 1] + y[i + 2]) / 5; if (m > best) { best = m; bi = i; } }
      return w[bi].t - tc;
    };
    offs.push(peak(t1) * 1000); ons.push(peak(t2) * 1000);
  }
  console.log(`${name.padEnd(10)} peak − takeoff: ${offs.map((x) => x.toFixed(0)).join(" ")} ms | peak − landing: ${ons.map((x) => x.toFixed(0)).join(" ")} ms`);
}
