/** Re-run findJumps on the poses logged with each re-measured jump; compare with the side-view truth. */
import { readFileSync } from "node:fs";
import { closestJump, jumpsIn } from "../../mobile/src/logic/measure";
import { POSE_POINTS } from "../../mobile/src/logic/diagnostics";

const D = "/Users/pl/code/boing-data";
const s = JSON.parse(readFileSync(`${D}/uploads/2026-10-19_233836/session.json`, "utf8"));
const truth = JSON.parse(readFileSync(`${D}/review/side_20261019/edges_redtoe.json`, "utf8"));
// side-video real time → app frame clock (from matching the jump sequences)
const OFFSET: Record<string, number> = { "233859": 520.22, "234100": 640.86 };
const BASE = 2139000;
const tr = truth.map((e: any) => ({ ...e, off: e.tOff + OFFSET[e.vid] + BASE, on: e.tOn + OFFSET[e.vid] + BASE }));

for (const l of [...s.logs].sort((a: any, b: any) => a.tOff - b.tOff)) {
  const t = tr.find((e: any) => Math.abs(e.off - l.tOff) < 0.5);
  const tag = t ? `${t.vid}#${t.n} truth ${(t.h * 100).toFixed(1)}` : "no jump on side video";
  if (!l.pose) {
    console.log(`${(l.tOff - BASE).toFixed(2)} live ${(l.hLive * 100).toFixed(1)} [${l.flagsLive}] not re-measured — ${tag}`);
    continue;
  }
  const p = l.pose;
  const frames = p.frames.map((r: number[]) => {
    if (r.length === 1) return { t: r[0] + p.t0, lm: null };
    const lm = Array.from({ length: 33 }, () => [NaN, NaN, 0, 0]);
    POSE_POINTS.forEach((k: number, i: number) => { lm[k] = [r[1 + 3 * i], r[2 + 3 * i], 0, r[3 + 3 * i]]; });
    return { t: r[0] + p.t0, lm };
  });
  const j = closestJump(jumpsIn(frames, { width: p.width, height: p.height }), l.tOff);
  if (!j) { console.log(`${(l.tOff - BASE).toFixed(2)} no jump in replay — ${tag}`); continue; }
  const pre = j.tOff - frames[0].t;
  console.log(`${(l.tOff - BASE).toFixed(2)} re ${(j.hPrimary * 100).toFixed(1)} / hF ${(j.hFlight * 100).toFixed(1)}  `
    + `hipRms ${(j.hipRmsRel * 100).toFixed(2)}% toeRms ${(j.toeRmsRel * 100).toFixed(2)}%  [${j.flags}]  pre-roll ${pre.toFixed(2)} s  — ${tag}`
    + (t ? `  Δoff ${((j.tOff - t.off) * 1000).toFixed(0)} ms Δon ${((j.tOn - t.on) * 1000).toFixed(0)} ms Δapex-mid ${((j.tApex - (t.off + t.on) / 2) * 1000).toFixed(0)} ms` : ""));
}
