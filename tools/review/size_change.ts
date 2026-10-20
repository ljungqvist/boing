/**
 * Does the person's apparent size change across a jump (moving towards or away from the camera)?
 * Hip and shoulder width (px) standing before takeoff vs after landing, for every jump in every pose
 * file at hand, next to hPrimary / hFlight. Usage: npx tsx tools/review/size_change.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { findJumps, type Jump } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import type { PoseFrame } from "../../src/analysis/types";
import { POSE_POINTS } from "../../mobile/src/logic/diagnostics";

const D = "/Users/pl/code/boing-data";
type Src = { id: string; view: string; width: number; height: number; fps: number; frames: PoseFrame[]; timeScale?: number };

function width(f: PoseFrame, a: number, b: number, W: number, H: number): number {
  const p = f.lm?.[a], q = f.lm?.[b];
  if (!p || !q || p[3] < 0.5 || q[3] < 0.5) return NaN;
  return Math.hypot((p[0] - q[0]) * W, (p[1] - q[1]) * H);
}
function median(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}
export function sizeChange(frames: PoseFrame[], W: number, H: number, j: Jump) {
  const sel = (a: number, b: number) => frames.filter((f) => f.t >= a && f.t <= b);
  const before = sel(j.tOff - 0.9, j.tOff - 0.45), after = sel(j.tOn + 0.2, j.tOn + 0.6);
  const r = (a: number, b: number) =>
    median(after.map((f) => width(f, a, b, W, H))) / median(before.map((f) => width(f, a, b, W, H)));
  // In the air: just after takeoff vs just before landing (no stance change possible).
  const up = sel(j.tOff, j.tOff + 0.07), down = sel(j.tOn - 0.07, j.tOn);
  const rAir = (a: number, b: number) =>
    median(down.map((f) => width(f, a, b, W, H))) / median(up.map((f) => width(f, a, b, W, H)));
  return { hips: r(23, 24), shoulders: r(11, 12), hipsAir: rAir(23, 24), shouldersAir: rAir(11, 12) };
}

const sources: Src[] = [];
// Whole videos (heavy, every frame).
const manifest = JSON.parse(readFileSync(new URL("../../testdata/videos.json", import.meta.url), "utf8"));
for (const e of manifest) {
  const p = `${D}/landmarks/${e.id}.json`;
  if (!existsSync(p)) continue;
  const v = JSON.parse(readFileSync(p, "utf8"));
  const ts = v.timeScale ?? 1;
  sources.push({ id: e.id, view: e.view, width: v.width, height: v.height, fps: v.fps / ts,
    frames: v.frames.map((f: PoseFrame) => ({ t: f.t * ts, lm: f.lm })) });
}
// Native re-measured windows of 2026-10-15 (table, floor).
for (const dir of ["table", "floor"]) {
  for (const f of readdirSync(`${D}/review/${dir}`).filter((x) => x.endsWith(".json"))) {
    const v = JSON.parse(readFileSync(`${D}/review/${dir}/${f}`, "utf8"));
    sources.push({ id: `${dir}/${f}`, view: "front, native", width: v.width, height: v.height, fps: v.fps, frames: v.frames });
  }
}
// Web sessions: the refined pieces.
for (const f of readdirSync(`${D}/sessions`)) {
  const s = JSON.parse(readFileSync(`${D}/sessions/${f}`, "utf8"));
  for (const j of s.jumps ?? []) {
    if (!j.refined) continue;
    sources.push({ id: `session ${f} @${j.tOff.toFixed(1)}`, view: "front, web", width: j.refined.width, height: j.refined.height,
      fps: j.refined.fps, frames: j.refined.frames });
  }
}
// Native debug upload of 2026-10-19 (compact poses).
for (const dir of readdirSync(`${D}/uploads`)) {
  const p = `${D}/uploads/${dir}/session.json`;
  if (!existsSync(p)) continue;
  const s = JSON.parse(readFileSync(p, "utf8"));
  for (const l of s.logs ?? []) {
    if (!l.pose) continue;
    const pose = l.pose;
    const frames: PoseFrame[] = pose.frames.map((r: number[]) => {
      if (r.length === 1) return { t: r[0] + pose.t0, lm: null };
      const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0] as [number, number, number, number]);
      POSE_POINTS.forEach((k, i) => { lm[k] = [r[1 + 3 * i], r[2 + 3 * i], 0, r[3 + 3 * i]]; });
      return { t: r[0] + pose.t0, lm };
    });
    sources.push({ id: `upload ${dir} @${(l.tOff % 1000).toFixed(1)}`, view: "front, native", width: pose.width, height: pose.height, fps: 30, frames });
  }
}

const rows: string[] = [];
for (const s of sources) {
  for (const j of findJumps(toSignals(s))) {
    if (j.hFlight < 0.05 || j.flags.includes("not-parabola") || j.flags.includes("g-implausible") || j.flags.includes("few-frames")) continue;
    const c = sizeChange(s.frames, s.width, s.height, j);
    const pct = (x: number) => (Number.isFinite(x) ? `${x >= 1 ? "+" : ""}${((x - 1) * 100).toFixed(1)}%` : "  n/a").padStart(7);
    rows.push(`${pct(c.hipsAir)} ${pct(c.shouldersAir)} | ${pct(c.hips)} ${pct(c.shoulders)}  hP/hF ${(j.hPrimary / j.hFlight).toFixed(2)}  ${(j.hPrimary * 100).toFixed(1).padStart(5)} / ${(j.hFlight * 100).toFixed(1).padStart(5)} cm  `
      + `${s.id} t=${j.tOff.toFixed(2)} [${s.view}] [${j.flags.join(",")}]`);
  }
}
console.log("air: hips shoulders | stand: hips shoulders");
console.log(rows.sort((a, b) => Math.abs(parseFloat(b)) - Math.abs(parseFloat(a))).join("\n"));
