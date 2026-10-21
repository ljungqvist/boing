/**
 * Takeoff→apex can't really exceed the flight-time height (the body is never more stretched than at
 * takeoff). Variants that cap or reject hPrimary against hFlight, on every set with a truth:
 * the native simulations of the 240/120 fps videos, the 2026-10-15 table/floor sessions and the
 * 2026-10-19 side-view session. Usage: npx tsx tools/review/cap_eval.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { findJumps, type Jump } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import type { PoseFrame } from "../../src/analysis/types";
import { POSE_POINTS } from "../../mobile/src/logic/diagnostics";
import { REJECT } from "../../mobile/src/logic/measure";
import { evaluate, type Finder } from "./simeval";
import { FLOOR_TRUTH, TABLE_TRUTH } from "./table_truth";

const D = "/Users/pl/code/boing-data";
interface Variant { name: string; cap?: number; reject?: number }
const VARIANTS: Variant[] = [
  { name: "today (reject > 1.2)" },
  { name: "reject > 1.15", reject: 1.15 },
  { name: "cap 1.0", cap: 1.0 },
  { name: "cap 1.05", cap: 1.05 },
  { name: "cap 1.0, reject > 1.15", cap: 1.0, reject: 1.15 },
];

/** A jump with the variant applied: hPrimary capped, `rejected` set. */
function apply(j: Jump, v: Variant): Jump & { rejected: boolean } {
  const ratio = j.hPrimary / j.hFlight;
  let rejected = j.flags.some((f) => (REJECT as string[]).includes(f));
  if (v.reject !== undefined && ratio > v.reject) rejected = true;
  const hPrimary = v.cap !== undefined ? Math.min(j.hPrimary, v.cap * j.hFlight) : j.hPrimary;
  return { ...j, hPrimary, rejected };
}
const finderOf = (v: Variant): Finder => (frames, size) => findJumps(toSignals({ ...size, fps: 0, frames })).map((j) => apply(j, v));

type Res = { truth: number; h: number; rejected: boolean };

function simSet(dir: string, model: string, fpsWanted: number[], v: Variant): Res[] {
  return evaluate(`${D}/review/${dir}`, finderOf(v))
    .filter((r) => r.model === model && fpsWanted.includes(Math.round(r.fps)) && r.found)
    .map((r) => ({ truth: r.hTruth, h: r.hP, rejected: !r.accepted }));
}

function nativeSet(v: Variant): Res[] {
  const out: Res[] = [];
  for (const dir of ["table", "floor"]) {
    for (const f of readdirSync(`${D}/review/${dir}`).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(`${D}/review/${dir}/${f}`, "utf8"));
      const tr = TABLE_TRUTH[d.log.clip] ?? FLOOR_TRUTH[d.log.clip];
      if (!tr) continue;
      const t1 = tr.off + d.log.clipStart, t2 = tr.on + d.log.clipStart;
      const j = findJumps(toSignals(d)).sort((a, b) => Math.abs(a.tOff - t1) - Math.abs(b.tOff - t1))[0];
      if (!j || Math.abs(j.tOff - t1) > 0.5) continue;
      const a = apply(j, v);
      out.push({ truth: 9.81 * (t2 - t1) ** 2 / 8, h: a.hPrimary, rejected: a.rejected });
    }
  }
  return out;
}

function sideSet(v: Variant): Res[] {
  const s = JSON.parse(readFileSync(`${D}/uploads/2026-10-19_233836/session.json`, "utf8"));
  const truth = JSON.parse(readFileSync(`${D}/review/side_20261019/edges_redtoe.json`, "utf8"));
  const OFFSET: Record<string, number> = { "233859": 2139520.22, "234100": 2139640.86 };
  const out: Res[] = [];
  for (const l of s.logs) {
    if (!l.pose) continue;
    const t = truth.find((e: any) => Math.abs(e.tOff + OFFSET[e.vid] - l.tOff) < 0.5);
    if (!t) continue;
    const p = l.pose;
    const frames: PoseFrame[] = p.frames.map((r: number[]) => {
      if (r.length === 1) return { t: r[0] + p.t0, lm: null };
      const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0] as [number, number, number, number]);
      POSE_POINTS.forEach((k, i) => { lm[k] = [r[1 + 3 * i], r[2 + 3 * i], 0, r[3 + 3 * i]]; });
      return { t: r[0] + p.t0, lm };
    });
    const j = findJumps(toSignals({ width: p.width, height: p.height, fps: 30, frames }))
      .sort((a, b) => Math.abs(a.tOff - l.tOff) - Math.abs(b.tOff - l.tOff))[0];
    if (!j) continue;
    const a = apply(j, v);
    out.push({ truth: t.h, h: a.hPrimary, rejected: a.rejected });
  }
  return out;
}

function summary(rs: Res[]): string {
  const e = rs.filter((r) => !r.rejected).map((r) => (r.h - r.truth) * 100);
  const m = e.reduce((a, b) => a + b, 0) / e.length;
  const sd = Math.sqrt(e.reduce((a, b) => a + (b - m) ** 2, 0) / e.length);
  const worst = e.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  return `${String(e.length).padStart(3)}/${String(rs.length).padEnd(3)} ${m >= 0 ? "+" : ""}${m.toFixed(1)} ± ${sd.toFixed(1)}, worst ${worst >= 0 ? "+" : ""}${worst.toFixed(1)}`;
}

const SETS: [string, (v: Variant) => Res[]][] = [
  ["sim 240→30 heavy sharp", (v) => simSet("sim_020914", "heavy", [30], v)],
  ["sim 240→30 heavy blur 1/60", (v) => simSet("sim_020914_blur4", "heavy", [30], v)],
  ["sim 240→30 heavy blur 1/30", (v) => simSet("sim_020914_blur8", "heavy", [30], v)],
  ["sim 240→60 heavy sharp", (v) => simSet("sim_020914", "heavy", [60], v)],
  ["sim 240→30 full sharp", (v) => simSet("sim_020914", "full", [30], v)],
  ["sim 120→30 heavy sharp", (v) => simSet("sim_174441", "heavy", [30], v)],
  ["sim 120→30 heavy blur", (v) => simSet("sim_174441_blur4", "heavy", [30], v)],
  ["native 2026-10-15 table+floor", nativeSet],
  ["native 2026-10-19 side truth", sideSet],
];
console.log("accepted/all, error of the shown height vs flight-time truth (cm)\n");
for (const v of VARIANTS) {
  console.log(v.name);
  for (const [name, f] of SETS) console.log(`  ${name.padEnd(32)} ${summary(f(v))}`);
}
