import type { Landmark, PoseFrame } from "../../../src/analysis/types";

/** Below this many analysed frames per second, the live analysis may miss jumps. */
export const MIN_FPS = 15;

export type Tone = "idle" | "ready" | "adjust" | "air" | "error";

export interface Status {
  text: string;
  tone: Tone;
}

const TOES = [31, 32];
const HIPS = [23, 24];

/** Toes clearly above where they stood during the last two seconds. */
export function airborne(history: PoseFrame[], lm: Landmark[] | null): boolean {
  if (!lm || history.length === 0 || TOES.some((i) => lm[i][3] < 0.5)) return false;
  const toeY = (l: Landmark[]) => (l[31][1] + l[32][1]) / 2;
  const t = history[history.length - 1].t;
  const ys = history.filter((f) => f.lm && f.t > t - 2).map((f) => toeY(f.lm!)).sort((a, b) => b - a);
  if (ys.length === 0) return false;
  const floor = ys[Math.floor(ys.length * 0.25)];
  const body = (lm[29][1] + lm[30][1]) / 2 - lm[0][1];
  return floor - toeY(lm) > 0.04 * body;
}

/**
 * The live status line. Only about the setup (body and feet in view), never about how to jump.
 * `fps` is the live analysis rate, `warm` whether the analysis has run long enough to judge it.
 */
export function liveStatus(history: PoseFrame[], lm: Landmark[] | null, fps: number, warm: boolean): Status {
  const visible = (idx: number[]) => !!lm && idx.every((i) => lm[i][3] > 0.5);
  if (!lm) return { text: "Looking for you…", tone: "idle" };
  if (!visible(TOES)) return { text: "Feet not visible · step back", tone: "adjust" };
  if (!visible(HIPS)) return { text: "Hips not visible · step back", tone: "adjust" };
  if (airborne(history, lm)) return { text: "Jump!", tone: "air" };
  if (warm && fps < MIN_FPS) return { text: `Ready · slow analysis (${Math.round(fps)} fps)`, tone: "adjust" };
  return { text: "Ready", tone: "ready" };
}
