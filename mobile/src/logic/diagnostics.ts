import type { JumpFlag } from "../../../src/analysis/jumps";
import { REJECT_TEXT } from "./measure";

type Entry = Record<string, unknown>;

const num = (e: Entry, k: string, d = 1) => (typeof e[k] === "number" ? (e[k] as number).toFixed(d) : "–");
const cmOf = (e: Entry, k: string) => (typeof e[k] === "number" ? ((e[k] as number) * 100).toFixed(1) : "–");
const reasons = (flags: unknown) =>
  Array.isArray(flags) ? (flags as JumpFlag[]).map((f) => REJECT_TEXT[f]).filter(Boolean).join(", ") : "";

/** The recorded file as stored: size, rotation, frame rate. */
function describeVideo(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Entry;
  if (e.error !== undefined) return `video: ${String(e.error)}`;
  return `video ${num(e, "width", 0)}×${num(e, "height", 0)}, rotation ${num(e, "rotation", 0)}°, ${num(e, "fps", 0)} fps`;
}

/** One line per live jump: how it was measured, and why re-measuring failed. */
export function describeLog(e: Entry): string {
  if (e.tOff === undefined) return String(e.error ?? JSON.stringify(e));
  const live = `live ${cmOf(e, "hLive")} cm (${e.framesLive ?? "–"} fr)`;
  if (e.h !== undefined && !e.error) {
    return `t ${num(e, "tOff")} s · ${live} → ${cmOf(e, "h")} cm (${e.frames} fr, ${num(e, "fps", 0)} fps, ${num(e, "ms", 0)} ms, offset ${num(e, "offset", 2)} s)`;
  }
  const why = e.error ?? e.reason ?? "?";
  const parts = [`t ${num(e, "tOff")} s`, live, `not re-measured: ${why}${e.ms !== undefined ? ` (${num(e, "ms", 0)} ms)` : ""}`];
  if (e.h !== undefined) {
    const r = reasons(e.flags);
    parts.push(`re-measured ${cmOf(e, "h")} cm (${e.frames} fr, g ${num(e, "g")}, offset ${num(e, "offset", 2)} s)${r ? `: ${r}` : ""}`);
  }
  if (Array.isArray(e.found)) {
    const near = (e.found as Entry[]).map((j) => `${num(j, "offset", 2)} s ${cmOf(j, "h")} cm`).join(", ");
    parts.push(`movements found: ${near || "none"}`);
  }
  if (e.analysed !== undefined) parts.push(`${e.analysed} frames at ${num(e, "fps", 0)} fps, ${e.withPose ?? "–"} with a person`);
  const video = describeVideo(e.video);
  if (video) parts.push(video);
  return parts.join(" · ");
}

/** Everything the diagnostics show, as text to share (readable lines, then the raw entries). */
export function diagnosticsReport(context: Entry, logs: Entry[]): string {
  return [
    "Boing diagnostics",
    ...Object.entries(context).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
    "",
    ...(logs.length ? logs.map(describeLog) : ["(no jumps yet)"]),
    "",
    JSON.stringify(logs),
  ].join("\n");
}
