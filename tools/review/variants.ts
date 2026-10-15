/** Accepted jumps per landmark file under several option sets of the experimental finder. */
import { readFileSync, readdirSync } from "node:fs";
import { findJumpsExp, type ExpOptions } from "./jumps_exp";

export const VARIANTS: Record<string, ExpOptions> = {
  base: {},
  clamp: { clampEdges: true },
  land: { landFloor: "after" },
  cl_land: { clampEdges: true, landFloor: "after" },
  trunk: { clampEdges: true, landFloor: "after", apex: "trunk" },
  com: { clampEdges: true, landFloor: "after", apex: "com" },
  mid: { clampEdges: true, landFloor: "after", final: "mid" },
  avgCom: { clampEdges: true, landFloor: "after", apex: "com", final: "avg" },
  flight: { clampEdges: true, landFloor: "after", final: "flight" },
};

const files = process.argv.slice(2);
const only = (process.env.VARIANTS ?? Object.keys(VARIANTS).join(",")).split(",");
for (const path of files) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  if (v.timeScale) for (const fr of v.frames) fr.t *= v.timeScale;
  const per = only.map((name) => findJumpsExp(v, VARIANTS[name]).filter((j) => !j.rejected && j.hPrimary < 2));
  // Align by takeoff time against the base list.
  const times = [...new Set(per.flatMap((js) => js.map((j) => Math.round(j.tOff * 4) / 4)))].sort((a, b) => a - b);
  console.log(`\n${path.split("/").pop()}`);
  console.log("tOff   " + only.map((n) => n.padStart(9)).join(""));
  for (const t of times) {
    const cells = per.map((js) => { const j = js.find((x) => Math.abs(x.tOff - t) < 0.2); return j ? (j.hPrimary * 100).toFixed(1).padStart(9) : "        –"; });
    console.log(t.toFixed(2).padStart(6) + " " + cells.join(""));
  }
}
