/** Per-jump mean error of a finder over the phases of each library set (front vs side for the same jumps). */
import { evaluateAll, expFinder } from "./evaluate";
const o = JSON.parse(process.argv[2] ?? "{}");
const sets = evaluateAll(expFinder(o)).filter((rs) => rs[0]?.set.includes("2026-10-19"));
const ids = [...new Set(sets.flatMap((rs) => rs.map((r) => r.id.split("/")[0])))].sort();
const name = (s: string) => s.replace(" (2026-10-19)", "").replace("side, sim 240→", "side ").replace("front, native 30 fps", "front 30 real");
console.log("jump".padEnd(16) + sets.map((rs) => name(rs[0].set).padStart(22)).join(""));
for (const id of ids) {
  const cells = sets.map((rs) => {
    const r = rs.filter((x) => x.id.split("/")[0] === id);
    const ok = r.filter((x) => x.found && !x.rejected);
    if (!r.length) return "".padStart(22);
    const e = ok.map((x) => (x.h - x.truth) * 100);
    const m = e.length ? e.reduce((a, b) => a + b, 0) / e.length : NaN;
    return `${Number.isFinite(m) ? (m >= 0 ? "+" : "") + m.toFixed(1) : "  –"} (${ok.length}/${r.length})`.padStart(22);
  });
  console.log(id.padEnd(16) + cells.join(""));
}
