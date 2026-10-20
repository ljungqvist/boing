/**
 * Option sets of the experimental finder (jumps_exp.ts) on every set with a flight-time truth:
 * native simulations of the 240/120 fps videos, the native 2026-10-15 table/floor sessions and the
 * 2026-10-19 side-view session. Usage: npx tsx tools/review/edge_eval.ts ['{"name":{opts}}']
 */
import { readdirSync, readFileSync } from "node:fs";
import type { PoseFrame } from "../../src/analysis/types";
import { POSE_POINTS } from "../../mobile/src/logic/diagnostics";
import { findJumpsExp, type ExpJump, type ExpOptions } from "./jumps_exp";
import { evaluate } from "./simeval";
import { FLOOR_TRUTH, TABLE_TRUTH } from "./table_truth";

const D = "/Users/pl/code/boing-data";
type Res = { truth: number; h: number; rejected: boolean };
const near = (js: ExpJump[], t: number) => js.sort((a, b) => Math.abs(a.tOff - t) - Math.abs(b.tOff - t))[0];

function simSet(dir: string, model: string, fps: number, o: ExpOptions): Res[] {
  return evaluate(`${D}/review/${dir}`, (frames, size) => findJumpsExp({ ...size, fps: 0, frames }, o))
    .filter((r) => r.model === model && Math.round(r.fps) === fps && r.found)
    .map((r) => ({ truth: r.hTruth, h: r.hP, rejected: !r.accepted }));
}

function nativeSet(o: ExpOptions): Res[] {
  const out: Res[] = [];
  for (const dir of ["table", "floor"]) {
    for (const f of readdirSync(`${D}/review/${dir}`).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(`${D}/review/${dir}/${f}`, "utf8"));
      const tr = TABLE_TRUTH[d.log.clip] ?? FLOOR_TRUTH[d.log.clip];
      if (!tr) continue;
      const t1 = tr.off + d.log.clipStart, t2 = tr.on + d.log.clipStart;
      const j = near(findJumpsExp(d, o), t1);
      if (!j || Math.abs(j.tOff - t1) > 0.5) continue;
      out.push({ truth: 9.81 * (t2 - t1) ** 2 / 8, h: j.hPrimary, rejected: j.rejected });
    }
  }
  return out;
}

const side = (() => {
  const s = JSON.parse(readFileSync(`${D}/uploads/2026-10-19_233836/session.json`, "utf8"));
  const truth = JSON.parse(readFileSync(`${D}/review/side_20261019/edges_redtoe.json`, "utf8"));
  const OFFSET: Record<string, number> = { "233859": 2139520.22, "234100": 2139640.86 };
  const out: { tOff: number; truth: number; video: { width: number; height: number; fps: number; frames: PoseFrame[] } }[] = [];
  for (const l of s.logs) {
    if (!l.pose) continue;
    const t = truth.find((e: { tOff: number; vid: string }) => Math.abs(e.tOff + OFFSET[e.vid] - l.tOff) < 0.5);
    if (!t) continue;
    const p = l.pose;
    const frames: PoseFrame[] = p.frames.map((r: number[]) => {
      if (r.length === 1) return { t: r[0] + p.t0, lm: null };
      const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0] as [number, number, number, number]);
      POSE_POINTS.forEach((k, i) => { lm[k] = [r[1 + 3 * i], r[2 + 3 * i], 0, r[3 + 3 * i]]; });
      return { t: r[0] + p.t0, lm };
    });
    out.push({ tOff: l.tOff + (l.offset ?? 0), truth: t.h, video: { width: p.width, height: p.height, fps: 30, frames } });
  }
  return out;
})();
function sideSet(o: ExpOptions): Res[] {
  return side.flatMap((x) => {
    const j = near(findJumpsExp(x.video, o), x.tOff);
    return j ? [{ truth: x.truth, h: j.hPrimary, rejected: j.rejected }] : [];
  });
}

function summary(rs: Res[]): string {
  const e = rs.filter((r) => !r.rejected).map((r) => (r.h - r.truth) * 100);
  if (!e.length) return `  0/${rs.length}`;
  const m = e.reduce((a, b) => a + b, 0) / e.length;
  const sd = Math.sqrt(e.reduce((a, b) => a + (b - m) ** 2, 0) / e.length);
  const worst = e.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
  return `${String(e.length).padStart(3)}/${String(rs.length).padEnd(3)} ${f(m)} ± ${sd.toFixed(1)}, worst ${f(worst)}`;
}

const SETS: [string, (o: ExpOptions) => Res[]][] = [
  ["sim 240→30 heavy sharp", (o) => simSet("sim_020914", "heavy", 30, o)],
  ["sim 240→30 heavy blur 1/30", (o) => simSet("sim_020914_blur8", "heavy", 30, o)],
  ["sim 240→60 heavy sharp", (o) => simSet("sim_020914", "heavy", 60, o)],
  ["sim 120→30 heavy blur", (o) => simSet("sim_174441_blur4", "heavy", 30, o)],
  ["native 10-15 table+floor 60fps", nativeSet],
  ["native 10-19 side truth 30fps", sideSet],
];
const VARIANTS: Record<string, ExpOptions> = process.argv[2] ? JSON.parse(process.argv[2]) : {
  base: {},
  "toeFitBelow 0.7": { toeFitBelow: 0.7 },
  "toeFitBelow 0.8": { toeFitBelow: 0.8 },
  "toeFitBelow 0.9": { toeFitBelow: 0.9 },
  local: { edges: "local" },
  knee: { edges: "knee" },
  "perFoot last": { edges: "perFoot", feet: "last" },
  clampEdges: { clampEdges: true },
};
console.log("accepted/all, error of the shown height vs flight-time truth (cm)");
for (const [name, o] of Object.entries(VARIANTS)) {
  console.log(name);
  for (const [s, f] of SETS) console.log(`  ${s.padEnd(32)} ${summary(f(o))}`);
}
