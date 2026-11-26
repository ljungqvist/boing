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

/** What `pickCamera` needs to know about a camera. */
export interface PickableCamera {
  id: string;
  hasTorch: boolean;
  supportedFPSRanges: { min: number; max: number }[];
}

/** Cameras whose top frame rate is more than this far below the best one are not considered. */
const FPS_TOLERANCE = 0.9;

/**
 * The camera to use among the cameras of one side of the phone (front or back).
 * With the torch wanted only cameras with a flash count (all of them if none has one). Cameras that
 * are clearly slower than the fastest are dropped. Then the system's default camera if it is still
 * there, otherwise the lowest id. No lens names: the first camera is usually the good one.
 */
export function pickCamera<T extends PickableCamera>(cameras: T[], defaultId: string | undefined, wantTorch: boolean): T | undefined {
  let pool = cameras;
  if (wantTorch && pool.some((c) => c.hasTorch)) pool = pool.filter((c) => c.hasTorch);
  const fastest = Math.max(0, ...pool.map((c) => bestFps(c.supportedFPSRanges)));
  pool = pool.filter((c) => bestFps(c.supportedFPSRanges) >= fastest * FPS_TOLERANCE);
  return (
    pool.find((c) => c.id === defaultId) ??
    [...pool].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))[0]
  );
}
