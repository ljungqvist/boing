/**
 * Native app "Share pose data" report → one landmark file per re-measured jump (PoseVideo JSON), for
 * dump.ts, variants.ts and the other review tools. Missing landmarks get visibility 0.
 * Usage: npx tsx tools/review/pose_import.ts <report.json|txt> <out_dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
const text = readFileSync(src, "utf8");
const r = JSON.parse(text.slice(text.indexOf("{")));
mkdirSync(out, { recursive: true });
for (const j of r.jumps) {
  const p = j.pose, pts: number[] = p.points;
  const frames = p.frames.map((f: number[]) => {
    if (f.length === 1) return { t: p.t0 + f[0], lm: null };
    const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
    pts.forEach((i, k) => (lm[i] = [f[1 + 3 * k], f[2 + 3 * k], 0, f[3 + 3 * k]]));
    return { t: p.t0 + f[0], lm };
  });
  const name = `${out}/jump_${j.tOff.toFixed(1)}.json`;
  writeFileSync(name, JSON.stringify({ width: p.width, height: p.height, fps: j.fps ?? 0, frames, log: { ...j, pose: undefined } }));
  console.log(name, `${frames.length} frames`, `app: ${(j.h * 100).toFixed(1)} / ${(j.hFlight * 100).toFixed(1)} cm`, j.flags?.join(",") ?? "");
}
