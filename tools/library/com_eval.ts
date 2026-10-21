/**
 * Centre-of-mass methods per pose model at 60 fps: the 2026-10-21 front jumps (hand-marked) and the
 * 2026-10-19 side jumps (sock-toe truth), with the app's own pose as the baseline.
 * Usage: npx tsx tools/library/com_eval.ts [--detail]
 */
import { type ExpOptions } from "../review/jumps_exp";
import { expFinder, librarySets, runSet, sideSets, sourceSets, summary, type Result } from "./evaluate";

const VARIANTS: Record<string, ExpOptions> = {
  "today": {},
  "apex: centre of mass": { apex: "com" },
  "hinge on the centre of mass, both edges": { edges: "comHinge" },
  "hinge, takeoff only": { edges: "comHinge", comEdges: "takeoff" },
  "hinge, landing only": { edges: "comHinge", comEdges: "landing" },
  "hinge both + apex com": { edges: "comHinge", apex: "com" },
  "joint fit, both edges": { edges: "comHinge", comGround: "joint" },
  "joint fit, landing only": { edges: "comHinge", comGround: "joint", comEdges: "landing" },
  "joint fit + apex com": { edges: "comHinge", comGround: "joint", apex: "com" },
};
const detail = process.argv.includes("--detail");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
for (const [name, o] of Object.entries(VARIANTS)) {
  if (only && !name.includes(only)) continue;
  const f = expFinder(o);
  const sets: Result[][] = [
    ...librarySets().filter((s) => s.name.includes("2026-10-21")).map((s) => runSet(s, f)),
    ...sideSets(f).filter((rs) => rs[0]?.set.includes("60 fps sharp")),
    ...sourceSets(f),
  ];
  console.log(name);
  for (const rs of sets) {
    console.log(`  ${rs[0].set.replace("front, native 60 fps (2026-10-21)", "front 60 fps (2026-10-21), app's pose (540×960, 13 points)").replace("side, sim 240→60 fps sharp (2026-10-19)", "side 60 fps (2026-10-19), MediaPipe 540×960 (app-like)").padEnd(66)} ${summary(rs)}`);
    if (detail) for (const r of rs) console.log(`      ${r.id.padEnd(22)} ${(r.truth * 100).toFixed(1)} → ${(r.h * 100).toFixed(1)}${r.rejected ? " ✗" : ""}  Δoff ${(r.dOff * 1000).toFixed(0)} Δon ${(r.dOn * 1000).toFixed(0)}  [${r.flags.join(",")}]`);
  }
}
