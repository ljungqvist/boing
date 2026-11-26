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

/** What the camera list needs from a VisionCamera device (so it can be tested with plain objects). */
export interface CameraLike {
  id: string;
  position: string;
  type: string;
  isVirtualDevice: boolean;
  physicalDevices: { type: string }[];
  hasTorch: boolean;
  supportedFPSRanges: { min: number; max: number }[];
  focalLength?: number;
  minZoom: number;
  maxZoom: number;
  getSupportedResolutions(kind: "video" | "stream"): { width: number; height: number }[];
}

const largest = (sizes: { width: number; height: number }[]) =>
  sizes.reduce<{ width: number; height: number } | null>((a, b) => (!a || b.width * b.height > a.width * a.height ? b : a), null);

const trim = (x: number) => String(Math.round(x * 10) / 10);

/** One camera for the list in Settings: a title and a few lines (lenses, flash, frame rates, sizes). */
export function describeCamera(d: CameraLike, inUse: boolean): { title: string; lines: string[] } {
  const side = d.position === "back" ? "Back" : d.position === "front" ? "Front" : d.position;
  const title = `${side} · id ${d.id}${inUse ? " · in use" : ""}`;
  const lens = d.isVirtualDevice && d.physicalDevices.length > 0
    ? `${d.type}: ${d.physicalDevices.map((p) => p.type).join(" + ")}`
    : d.type;
  const maxFps = Math.max(0, ...d.supportedFPSRanges.map((r) => r.max));
  const ranges = [...new Set(d.supportedFPSRanges.map((r) => (r.min === r.max ? `${trim(r.max)}` : `${trim(r.min)}–${trim(r.max)}`)))];
  const sizes = (kind: "video" | "stream") => {
    try {
      const s = largest(d.getSupportedResolutions(kind));
      return s ? `${s.width}×${s.height}` : "–";
    } catch {
      return "?";
    }
  };
  return {
    title,
    lines: [
      lens,
      `Flash ${d.hasTorch ? "yes" : "no"} · zoom ${trim(d.minZoom)}–${trim(d.maxZoom)}×` + (d.focalLength ? ` · ${trim(d.focalLength)} mm` : ""),
      `Frame rate up to ${trim(maxFps)} fps (ranges ${ranges.join(", ") || "–"})`,
      `Largest video ${sizes("video")} · frames for analysis ${sizes("stream")}`,
    ],
  };
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
