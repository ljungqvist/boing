/** 240 fps: when each toe point crosses floor + lift, against hand-marked last-foot-off / first-foot-down. */
import { readFileSync } from "node:fs";

const v = JSON.parse(readFileSync("../boing-data/landmarks/own-20261014_020914.json", "utf8"));
const sc = v.timeScale, H = v.height;
const T = [7.325, 12.421, 17.661, 25.089, 31.239, 38.076, 46.484];
const F = [342, 392, 367, 397, 362, 378, 368];
const fr = v.frames.map((f: any) => ({ t: f.t * sc, lm: f.lm }));
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
for (const liftPct of [0, 1, 2, 3]) {
  const rows: string[] = [];
  const errs: number[][] = [[], [], [], []];
  for (let k = 0; k < T.length; k++) {
    const t1 = T[k], t2 = t1 + F[k] / 1000;
    const body = med(fr.filter((f: any) => f.lm && f.t > t1 - 2 && f.t < t1 - 1).map((f: any) => (f.lm[29][1] + f.lm[30][1]) / 2 * H - f.lm[0][1] * H));
    const res: number[] = [];
    for (const toe of [31, 32]) {
      const y = (f: any) => H - f.lm[toe][1] * H;
      const before = fr.filter((f: any) => f.lm && f.t > t1 - 0.6 && f.t < t1 - 0.1).map(y);
      const after = fr.filter((f: any) => f.lm && f.t > t2 + 0.15 && f.t < t2 + 0.6).map(y);
      const flB = med(before), flA = med(after), lift = liftPct / 100 * body;
      const mid = (t1 + t2) / 2;
      const near = fr.filter((f: any) => f.lm && f.t > t1 - 0.2 && f.t < t2 + 0.2);
      // Last crossing upwards before mid, first crossing downwards after mid (linear interpolation).
      let up = NaN, down = NaN;
      for (let i = 1; i < near.length; i++) {
        const a = near[i - 1], b = near[i];
        if (b.t <= mid && y(a) <= flB + lift && y(b) > flB + lift) up = a.t + (flB + lift - y(a)) / (y(b) - y(a)) * (b.t - a.t);
        if (a.t >= mid && Number.isNaN(down) && y(a) > flA + lift && y(b) <= flA + lift) down = a.t + (y(a) - flA - lift) / (y(a) - y(b)) * (b.t - a.t);
      }
      res.push(up, down);
    }
    const [upL, downL, upR, downR] = res;
    const lastOff = Math.max(upL, upR), firstOn = Math.min(downL, downR);
    const meanOff = (upL + upR) / 2, meanOn = (downL + downR) / 2;
    errs[0].push((lastOff - t1) * 1000); errs[1].push((firstOn - t2) * 1000); errs[2].push((meanOff - t1) * 1000); errs[3].push((meanOn - t2) * 1000);
    rows.push(`  j${k + 1}: off L ${((upL - t1) * 1000).toFixed(0)} R ${((upR - t1) * 1000).toFixed(0)} | on L ${((downL - t2) * 1000).toFixed(0)} R ${((downR - t2) * 1000).toFixed(0)} ms`);
  }
  const m = (a: number[]) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(0);
  const sd = (a: number[]) => { const mm = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - mm) ** 2, 0) / a.length).toFixed(0); };
  console.log(`lift ${liftPct}% body: last-off ${m(errs[0])}±${sd(errs[0])} first-on ${m(errs[1])}±${sd(errs[1])} | mean-foot off ${m(errs[2])}±${sd(errs[2])} on ${m(errs[3])}±${sd(errs[3])} ms`);
  if (liftPct === 2) console.log(rows.join("\n"));
}
