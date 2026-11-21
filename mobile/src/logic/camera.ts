/** Highest frame rate a camera offers, capped (240 is as fast as the analysis needs). */
export function bestFps(ranges: { min: number; max: number }[], cap = 240): number {
  const maxes = ranges.map((r) => Math.min(r.max, cap)).filter((x) => x > 0);
  return maxes.length ? Math.max(...maxes) : 30;
}

/** Below this frame rate (real time) the height can be noticeably off: too few frames in the air. */
export const LOW_FPS = 40;

/** The frame rate as shown in the app, with a warning when it is below `LOW_FPS`; null if unknown. */
export function fpsLabel(fps: number | null | undefined): { text: string; low: boolean } | null {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return null;
  const low = Math.round(fps) < LOW_FPS;
  return { text: low ? `${Math.round(fps)} fps · accuracy may be off below ${LOW_FPS} fps` : `${Math.round(fps)} fps`, low };
}
