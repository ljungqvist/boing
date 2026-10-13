import { describe, expect, it } from "vitest";
import { choosePiece, pickMimeType, type Piece } from "./recorder";

const blob = new Blob(["x"]);
const piece = (start: number, end: number, done = true): Piece => ({ start, end, blob: done ? blob : null });

describe("choosePiece", () => {
  it("finds the piece that contains the window with margin", () => {
    const pieces = [piece(0, 6), piece(6, 12)];
    expect(choosePiece(pieces, 7, 9)).toBe(pieces[1]);
  });

  it("prefers the piece where the window is most central", () => {
    // Window 4.5–5.5 lies in both; it is central in 2–8 and near the end of 0–6.
    const pieces = [piece(0, 6), piece(2, 8), piece(4, 10)];
    expect(choosePiece(pieces, 4.5, 5.5)).toBe(pieces[1]);
  });

  it("needs the margin on both sides", () => {
    const pieces = [piece(0, 6)];
    expect(choosePiece(pieces, 0.1, 2, 0.3)).toBeNull();
    expect(choosePiece(pieces, 0.3, 2, 0.3)).toBe(pieces[0]);
    expect(choosePiece(pieces, 3, 5.8, 0.3)).toBeNull();
  });

  it("returns null while the covering piece is still recording", () => {
    const pieces = [piece(0, 6), piece(3, 9, false)];
    expect(choosePiece(pieces, 6, 8)).toBeNull();
  });

  it("returns null for a window older than all kept pieces", () => {
    const pieces = [piece(10, 16), piece(13, 19)];
    expect(choosePiece(pieces, 2, 4)).toBeNull();
  });
});

describe("pickMimeType", () => {
  it("prefers VP8 WebM, then WebM, then MP4", () => {
    expect(pickMimeType(() => true)).toBe("video/webm;codecs=vp8");
    expect(pickMimeType((t) => t === "video/webm" || t === "video/mp4")).toBe("video/webm");
    expect(pickMimeType((t) => t === "video/mp4")).toBe("video/mp4");
  });

  it("returns null when nothing can be recorded", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});
