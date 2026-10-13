/** A recorded piece of the camera stream; times in seconds on the live (camera) timeline. */
export interface Piece {
  start: number;
  end: number;
  /** The recording, once the piece has finished; null while it is still recording. */
  blob: Blob | null;
}

/**
 * The finished piece that contains `[from − margin, to + margin]`, preferring the one
 * where the window is most central. Null if no finished piece covers it (yet).
 */
export function choosePiece(pieces: Piece[], from: number, to: number, margin = 0.3): Piece | null {
  let best: Piece | null = null;
  let bestSlack = -Infinity;
  for (const p of pieces) {
    if (!p.blob || p.start > from - margin || p.end < to + margin) continue;
    const slack = Math.min(from - p.start, p.end - to); // room on the tighter side
    if (slack > bestSlack) [best, bestSlack] = [p, slack];
  }
  return best;
}

const MIME_TYPES = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];

/** The first recording format the browser supports, or null. */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return MIME_TYPES.find((t) => isTypeSupported(t)) ?? null;
}
