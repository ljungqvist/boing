import type { Size } from "./pose";

/**
 * The preview shows the camera's full picture, 3:4 in portrait (4:3 sensors). The analysed frames
 * are a centred crop of it with their own aspect (e.g. 9:16 cuts the sides). Measured on a Galaxy
 * Tab A8 and S24+; VisionCamera's own frame→preview conversion is off for the front camera.
 */
export const PREVIEW_ASPECT = 3 / 4;

/**
 * Maps a point of the analysed frame (normalised 0–1, upright) to preview-view coordinates.
 * The preview fills the view ("cover"); the front camera's preview is mirrored, its frames aren't.
 */
export function frameToView(
  x: number, y: number, frame: Size, view: Size, mirrored: boolean, previewAspect = PREVIEW_ASPECT,
): { x: number; y: number } {
  // Preview (camera picture) as displayed: filling the view, centred.
  const ph = Math.max(view.height, view.width / previewAspect);
  const pw = ph * previewAspect;
  // The frame's part of the camera picture: as large as fits, centred.
  const fa = frame.width / frame.height;
  const fw = fa < previewAspect ? ph * fa : pw;
  const fh = fa < previewAspect ? ph : pw / fa;
  const u = mirrored ? 1 - x : x;
  return { x: view.width / 2 + (u - 0.5) * fw, y: view.height / 2 + (y - 0.5) * fh };
}
