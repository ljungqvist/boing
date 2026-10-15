/** Native-simulation outputs under experimental option sets: error vs the hand-marked truth. */
import { evaluate, type Row } from "./simeval";
import { findJumpsExp, type ExpOptions } from "./jumps_exp";

const dir = process.argv[2];
const sets: Record<string, ExpOptions> = JSON.parse(process.env.SETS ?? JSON.stringify({
  base: {},
  clamp_land: { clampEdges: true, landFloor: "after" },
  com: { clampEdges: true, landFloor: "after", apex: "com" },
  flight: { clampEdges: true, landFloor: "after", final: "flight" },
  flightCorr: { clampEdges: true, landFloor: "after", final: "flightCorr" },
}));
const skip = (process.env.SKIP ?? "").split(",").filter(Boolean).map(Number);
const ref = process.env.REF ?? "flight"; // truth for the reported height: hand-marked flight time

const stats = (xs: number[]) => {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return "–";
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
  const rms = Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  return `${m >= 0 ? "+" : ""}${m.toFixed(1)} ±${sd.toFixed(1)} rms ${rms.toFixed(1)} [${Math.min(...a).toFixed(1)}, ${Math.max(...a).toFixed(1)}]`;
};

console.log(`| set | model fps | n | accepted | h − truth cm (accepted) | >3 cm | >5 cm | takeoff ms | landing ms |`);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [name, o] of Object.entries(sets)) {
  const rows: Row[] = evaluate(dir, (frames, size) => findJumpsExp({ ...size, fps: 0, frames }, o) as any);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (skip.includes(r.jump)) continue;
    const key = `${r.model} ${r.fps.toFixed(0)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [k, g] of [...groups].sort()) {
    const acc = g.filter((r) => r.found && !(r as any).rejected && r.accepted);
    const e = acc.map((r) => (r.hP - r.hTruth) * 100);
    console.log(`| ${name} | ${k} | ${g.length} | ${acc.length} | ${stats(e)} | ${e.filter((x) => Math.abs(x) > 3).length} | ${e.filter((x) => Math.abs(x) > 5).length} | ${stats(acc.map((r) => r.dOff * 1000))} | ${stats(acc.map((r) => r.dOn * 1000))} |`);
  }
}
