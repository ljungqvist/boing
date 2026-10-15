import type { JumpFlag } from "../../../src/analysis/jumps";
import type { PoseFrame } from "../../../src/analysis/types";
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

/** Everything the diagnostics show, as text to share (readable lines, then the raw entries without pose data). */
export function diagnosticsReport(context: Entry, logs: Entry[]): string {
  return [
    "Boing diagnostics",
    ...Object.entries(context).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
    "",
    ...(logs.length ? logs.map(describeLog) : ["(no jumps yet)"]),
    "",
    JSON.stringify(logs.map(({ pose: _pose, ...e }) => e)),
  ].join("\n");
}

/**
 * Landmarks kept per frame for offline analysis: nose, shoulders, hips, knees, ankles, heels, toes
 * (everything the jump analysis and its checks use).
 */
export const POSE_POINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

/**
 * Compact pose of the frames a jump was re-measured from: per frame the time (s, from the first frame)
 * and x, y, visibility of POSE_POINTS, or just the time when no person was found.
 */
export function compactPose(frames: PoseFrame[], size: { width: number; height: number }): Entry {
  const t0 = frames[0]?.t ?? 0;
  const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    width: size.width, height: size.height, t0, points: POSE_POINTS,
    frames: frames.map((f) => [r(f.t - t0, 4), ...(f.lm ? POSE_POINTS.flatMap((i) => [r(f.lm![i][0], 4), r(f.lm![i][1], 4), r(f.lm![i][3], 2)]) : [])]),
  };
}

/** Pose data of the latest re-measured jumps (at most `max`), as JSON text to share for offline analysis. */
export function poseReport(context: Entry, logs: Entry[], max = 8): string {
  const jumps = logs.filter((e) => e.pose).slice(0, max).map(({ pose, ...e }) => ({ ...e, pose }));
  return JSON.stringify({ boing: "pose", version: 1, ...context, jumps });
}
