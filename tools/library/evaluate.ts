/**
 * Evaluate jump finders on the jump library, split by view × frame rate × blur.
 *
 * Usage: npx tsx tools/library/evaluate.ts ['{"name": {<jumps_exp options>}, ...}'] [--detail]
 * Without arguments: today's findJumps. Each variant is run on every set; the table shows accepted/all
 * and the error of the shown height against the flight-time truth (cm).
 */
import { findJumps } from "../../src/analysis/jumps";
import { toSignals } from "../../src/analysis/signals";
import type { PoseFrame, PoseVideo } from "../../src/analysis/types";
import { REJECT } from "../../mobile/src/logic/measure";
import { findJumpsExp, type ExpOptions } from "../review/jumps_exp";
import { evaluate as simEvaluate } from "../review/simeval";
import { LIBRARY, loadLibrary, poseOf, truthOnPoseClock, type LibJump } from "./library";

export interface Found { tOff: number; tOn: number; hPrimary: number; hFlight: number; rejected: boolean; flags: string[] }
export type Finder = (v: PoseVideo) => Found[];
export interface Result { set: string; id: string; truth: number; found: boolean; h: number; rejected: boolean; dOff: number; dOn: number; flags: string[] }

export const todayFinder: Finder = (v) =>
  findJumps(toSignals(v)).map((j) => ({ ...j, rejected: j.flags.some((f) => (REJECT as string[]).includes(f)) }));
export const expFinder = (o: ExpOptions): Finder => (v) => findJumpsExp(v, o);

/** A named group of library jumps with the pose to run on. */
export interface LibSet { name: string; view: string; fps: string; blur: string; jumps: { j: LibJump; video: PoseVideo }[] }

export function librarySets(): LibSet[] {
  const lib = loadLibrary();
  if (!lib) return [];
  const sets: Record<string, LibSet> = {};
  const add = (key: string, s: Omit<LibSet, "jumps">, j: LibJump, video: PoseVideo) =>
    (sets[key] ??= { ...s, jumps: [] }).jumps.push({ j, video });
  for (const j of lib.jumps) {
    if (!j.truth) continue;
    for (const p of j.pose ?? []) {
      const video = poseOf(j, p.role);
      if (!video) continue;
      if (p.role === "front-heavy-app" && j.date === "2026-10-19")
        add("n30", { name: "front, native 30 fps (2026-10-19)", view: "front", fps: "30", blur: "real" }, j, video);
      else if (p.role === "front-heavy-app")
        add("n60", { name: "front, native 60 fps (2026-10-15)", view: "front", fps: "60", blur: "real" }, j, video);
      else if (p.role === "front-heavy-full-rate")
        add("full", { name: "front, full rate 60–240 fps (2026-10-13/14)", view: "front", fps: "60-240", blur: "real" }, j, video);
      else if (p.role.startsWith("side-")) {
        const [, fps, blur] = p.role.split("-"); // side-<fps>-<blur>[-...]
        add(p.role, { name: `side, simulated ${fps} fps ${blur} (2026-10-19)`, view: "side", fps, blur }, j, video);
      }
    }
  }
  return Object.values(sets);
}

export function runSet(s: LibSet, finder: Finder): Result[] {
  return s.jumps.map(({ j, video }) => {
    const t = truthOnPoseClock(j)!;
    const best = finder(video).filter((x) => Math.abs(x.tOff - t.off) < 0.5)
      .sort((a, b) => Math.abs(a.tOff - t.off) - Math.abs(b.tOff - t.off))[0];
    if (!best) return { set: s.name, id: j.id, truth: t.h, found: false, h: NaN, rejected: true, dOff: NaN, dOn: NaN, flags: [] };
    return { set: s.name, id: j.id, truth: t.h, found: true, h: best.hPrimary, rejected: best.rejected,
      dOff: best.tOff - t.off, dOn: best.tOn - t.on, flags: best.flags };
  });
}

/** The native simulations of the deleted 240/120 fps videos (derived sets, by path). */
export function simSets(finder: Finder): Result[][] {
  const out: Result[][] = [];
  const run = (dir: string, model: string, fps: number, name: string) => {
    const rows = simEvaluate(`${LIBRARY}/${dir}`, (frames: PoseFrame[], size) => finder({ ...size, fps: 0, frames }) as never)
      .filter((r) => r.model === model && Math.round(r.fps) === fps && r.found);
    out.push(rows.map((r) => ({ set: name, id: `${r.config}#${r.jump}`, truth: r.hTruth, found: true, h: r.hP, rejected: !r.accepted,
      dOff: r.dOff, dOn: r.dOn, flags: r.flags })));
  };
  run("../review/sim_020914", "heavy", 30, "front, sim 240→30 fps sharp (2026-10-14)");
  run("../review/sim_020914_blur8", "heavy", 30, "front, sim 240→30 fps blur 1/30 (2026-10-14)");
  run("../review/sim_020914", "heavy", 60, "front, sim 240→60 fps sharp (2026-10-14)");
  run("../review/sim_174441_blur4", "heavy", 30, "front, sim 120→30 fps blur 1/30 (2026-10-13)");
  return out;
}

export function summary(rs: Result[]): string {
  const e = rs.filter((r) => r.found && !r.rejected).map((r) => (r.h - r.truth) * 100);
  if (!e.length) return `  0/${rs.length}`;
  const m = e.reduce((a, b) => a + b, 0) / e.length;
  const sd = Math.sqrt(e.reduce((a, b) => a + (b - m) ** 2, 0) / e.length);
  const worst = e.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
  return `${String(e.length).padStart(3)}/${String(rs.length).padEnd(3)} ${f(m)} ± ${sd.toFixed(1)}, worst ${f(worst)}`;
}

export function evaluateAll(finder: Finder): Result[][] {
  return [...librarySets().map((s) => runSet(s, finder)), ...simSets(finder)];
}

if (process.argv[1]?.endsWith("evaluate.ts")) {
  const args = process.argv.slice(2);
  const detail = args.includes("--detail");
  const json = args.find((a) => a.startsWith("{"));
  const variants: [string, Finder][] = json
    ? Object.entries(JSON.parse(json) as Record<string, ExpOptions>).map(([n, o]) => [n, expFinder(o)])
    : [["today (findJumps)", todayFinder]];
  console.log("accepted/all, error of the shown height vs flight-time truth (cm)");
  for (const [name, finder] of variants) {
    console.log(name);
    for (const rs of evaluateAll(finder)) {
      console.log(`  ${rs[0]?.set.padEnd(48)} ${summary(rs)}`);
      if (detail) for (const r of rs) console.log(`      ${r.id.padEnd(30)} truth ${(r.truth * 100).toFixed(1)} → ${(r.h * 100).toFixed(1)}${r.rejected ? " ✗" : ""}  Δoff ${(r.dOff * 1000).toFixed(0)} Δon ${(r.dOn * 1000).toFixed(0)} ms  [${r.flags.join(",")}]`);
    }
  }
}
