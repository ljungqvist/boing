import type { Tone } from "./status";

/**
 * Blind mode: the back camera faces the jumper, so the screen faces away and nobody can read it.
 * Most of the screen then shows one colour, bright enough to see from the side or as a glow on the
 * floor or a wall, and "Measuring" is also said out loud.
 */

/**
 * How far (as the sine of the angle) the screen's normal must point below the horizon to enter
 * blind mode, and above it to leave it again: ≈ 3°, so a phone standing upright doesn't flicker.
 */
const HYSTERESIS = 0.05;

/**
 * Whether the screen faces below the horizon. `up` is the up direction (opposite to gravity) in the
 * phone's axes, z out of the screen; any length. `was` is the previous answer.
 */
export function screenFacesDown(up: { x: number; y: number; z: number }, was: boolean): boolean {
  const n = Math.hypot(up.x, up.y, up.z);
  if (!(n > 0)) return was;
  const z = up.z / n; // sine of the screen normal's elevation
  return was ? z < HYSTERESIS : z < -HYSTERESIS;
}

export type BlindColor = "red" | "green" | "orange";

/** Red: not ready. Green: someone in view, ready for a jump. Orange: in the air or being measured. */
export function blindColor(tone: Tone, measuring: boolean): BlindColor {
  if (measuring || tone === "air") return "orange";
  return tone === "ready" ? "green" : "red";
}
