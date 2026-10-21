/**
 * Evaluate native-simulation outputs (simulate_native.py) against the hand-marked truth.
 * Usage: npx tsx tools/review/simeval.ts <sim_dir> [--estimator name] [--detail]
 */
import { readFileSync, readdirSync } from "node:fs";
import { findJumps, type Jump } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import { REJECT } from "../../mobile/src/logic/measure";

export const TRUTH_020914 = {
  tOff: [7.325, 12.421, 17.661, 25.089, 31.239, 38.076, 46.484],
  flightMs: [342, 392, 367, 397, 362, 378, 368],
};
/** Hand-marked from feet crops (2026-10-15 review), ±1 frame at 120 fps. */
export const TRUTH_174441 = { tOff: [2.606, 6.030], flightMs: [429, 408] };
/** Truth and source frame rate of a simulation directory (by its name). */
const truthOf = (dir: string) => (dir.includes("174441") ? { truth: TRUTH_174441, base: 120 } : { truth: TRUTH_020914, base: 240 });

export type Finder = (frames: { t: number; lm: any }[], size: { width: number; height: number }) => Jump[];
export const defaultFinder: Finder = (frames, size) => findJumps(toSignals({ ...size, fps: 0, frames }));

export interface Row { config: string; model: string; fps: number; phase: number; jump: number; found: boolean; accepted: boolean;
  hP: number; hF: number; dOff: number; dOn: number; dApex: number; hTruth: number; flags: string[] }

export function evaluate(dir: string, finder: Finder = defaultFinder): Row[] {
  const rows: Row[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const m = f.match(/^(\w+)_e(\d+)_p(\d+)\.json$/);
    if (!m) continue;
    const data = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const size = { width: data.width, height: data.height };
    const { truth, base } = truthOf(dir);
    data.windows.forEach((w: any, k: number) => {
      const t1 = truth.tOff[k], t2 = t1 + truth.flightMs[k] / 1000;
      const hTruth = 9.81 * (t2 - t1) ** 2 / 8;
      const jumps = finder(w.frames, size);
      let best: Jump | null = null;
      for (const j of jumps) if (Math.abs(j.tOff - t1) < 0.5 && (!best || Math.abs(j.tOff - t1) < Math.abs(best.tOff - t1))) best = j;
      const row = { config: f.replace(".json", ""), model: m[1], fps: base / Number(m[2]), phase: Number(m[3]), jump: k + 1, hTruth };
      if (!best) { rows.push({ ...row, found: false, accepted: false, hP: NaN, hF: NaN, dOff: NaN, dOn: NaN, dApex: NaN, flags: [] }); return; }
      rows.push({ ...row, found: true, accepted: (best as any).rejected !== undefined ? !(best as any).rejected : !best.flags.some((x) => (REJECT as string[]).includes(x)),
        hP: best.hPrimary, hF: best.hFlight, dOff: best.tOff - t1, dOn: best.tOn - t2, dApex: best.tApex - (t1 + t2) / 2, flags: best.flags });
    });
  }
  return rows;
}

const stats = (xs: number[]) => {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return "–";
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
  return `${m >= 0 ? "+" : ""}${m.toFixed(1)} ±${sd.toFixed(1)} [${Math.min(...a).toFixed(1)}, ${Math.max(...a).toFixed(1)}]`;
};

export function summary(rows: Row[], skipJumps: number[] = []) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (skipJumps.includes(r.jump)) continue;
    const key = `${r.model} ${r.fps.toFixed(0)}fps`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  console.log("| model fps | n | found | accepted | hP−truth cm (accepted) | hF−truth cm | |err hP|>4cm | takeoff ms | landing ms | apex−mid ms |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const [k, g] of [...groups].sort()) {
    const acc = g.filter((r) => r.accepted);
    const eP = acc.map((r) => (r.hP - r.hTruth) * 100), eF = acc.map((r) => (r.hF - r.hTruth) * 100);
    console.log(`| ${k} | ${g.length} | ${g.filter((r) => r.found).length} | ${acc.length} | ${stats(eP)} | ${stats(eF)} | ${eP.filter((e) => Math.abs(e) > 4).length} | ${stats(acc.map((r) => r.dOff * 1000))} | ${stats(acc.map((r) => r.dOn * 1000))} | ${stats(acc.map((r) => r.dApex * 1000))} |`);
  }
}

if (process.argv[1]?.endsWith("simeval.ts")) {
  const dir = process.argv[2];
  const rows = evaluate(dir);
  summary(rows);
  console.log("\nwithout jump 5 (the person moved towards the camera):");
  summary(rows, [5]);
  if (process.argv.includes("--detail")) {
    for (const r of rows) console.log(`${r.config} j${r.jump} truth ${(r.hTruth * 100).toFixed(1)} hP ${(r.hP * 100).toFixed(1)} hF ${(r.hF * 100).toFixed(1)} off ${(r.dOff * 1000).toFixed(0)} on ${(r.dOn * 1000).toFixed(0)} apex ${(r.dApex * 1000).toFixed(0)} ${r.accepted ? "" : "REJ"} ${r.flags}`);
  }
}
