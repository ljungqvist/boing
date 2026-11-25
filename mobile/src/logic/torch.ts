/**
 * The back camera's flashlight, for dark rooms where the lighting can't be fixed.
 * Three modes: off (default), automatic (on when the picture is dark) and always on.
 */
export type TorchMode = "off" | "auto" | "on";

export const TORCH_MODES: readonly TorchMode[] = ["off", "auto", "on"];

/** The mode saved in the settings; anything unknown reads as off. */
export function torchModeOf(v: unknown): TorchMode {
  return v === "auto" || v === "on" ? v : "off";
}

/** The mode after one tap on the button: off → auto → on → off. */
export function nextTorchMode(m: TorchMode): TorchMode {
  return m === "off" ? "auto" : m === "auto" ? "on" : "off";
}

export const TORCH_LABEL: Record<TorchMode, string> = { off: "Flashlight off", auto: "Flashlight auto", on: "Flashlight on" };

/**
 * Mean brightness (0 to 1) of a 4-byte colour picture (BGRA on iOS, RGBA on Android: alpha is last
 * in both), from a sparse grid of about `samples` pixels. `stride` is the bytes per row. NaN if empty.
 */
export function meanBrightness(px: Uint8Array, width: number, height: number, stride: number, samples = 400): number {
  "worklet"; // runs on the camera's frame thread
  if (!(width > 0 && height > 0 && stride >= width * 4)) return NaN;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / samples)));
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(step / 2); y < height; y += step) {
    for (let x = Math.floor(step / 2); x < width; x += step) {
      const i = y * stride + x * 4;
      if (i + 2 >= px.length) continue;
      sum += px[i] + px[i + 1] + px[i + 2];
      n++;
    }
  }
  return n ? sum / (n * 3 * 255) : NaN;
}

/** Brightness below which the picture counts as dark (the camera's own exposure has already done what it can). */
export const DARK_BELOW = 0.12;
/** How long it must stay dark before the automatic mode turns the light on, in seconds. */
export const DARK_FOR_S = 1.5;

/**
 * Decides when the automatic mode turns the flashlight on: the (smoothed) picture is dark for a
 * while. Once on it stays on until the camera stops, otherwise the light itself would make the
 * picture bright and flicker it off again.
 */
export class DarkDetector {
  private darkSince: number | null = null;
  private on = false;

  /** Feed one brightness reading at time `t` (seconds). Returns whether the light should be on. */
  update(brightness: number, t: number): boolean {
    if (this.on || !Number.isFinite(brightness)) return this.on;
    if (brightness >= DARK_BELOW) {
      this.darkSince = null;
    } else {
      this.darkSince ??= t;
      if (t - this.darkSince >= DARK_FOR_S) this.on = true;
    }
    return this.on;
  }

  reset(): void {
    this.darkSince = null;
    this.on = false;
  }
}
