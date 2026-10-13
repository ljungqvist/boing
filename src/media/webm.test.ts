import { describe, expect, it } from "vitest";
import { parseWebM } from "./webm";

const enc = new TextEncoder();

/** EBML element with a known size (8-byte size field) or, with `size: "unknown"`, MediaRecorder style. */
function el(id: number, payload: Uint8Array | Uint8Array[], size: "known" | "unknown" = "known"): Uint8Array {
  const body = Array.isArray(payload) ? concat(...payload) : payload;
  const idBytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v & 0xff);
  const sz = new Uint8Array(8);
  sz[0] = 0x01; // 8-byte size
  if (size === "unknown") sz.fill(0xff, 1);
  else for (let i = 7, v = body.length; i > 0; i--, v = Math.floor(v / 256)) sz[i] = v & 0xff;
  return concat(new Uint8Array(idBytes), sz, body);
}
const uint = (v: number, n = 4) => { const b = new Uint8Array(n); for (let i = n - 1; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 0xff; return b; };
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** SimpleBlock on track 1: relative timecode, keyframe flag, payload. */
const block = (rel: number, key: boolean, data: number[]) =>
  el(0xa3, concat(new Uint8Array([0x81]), uint(rel & 0xffff, 2), new Uint8Array([key ? 0x80 : 0]), new Uint8Array(data)));

function webm(clusters: { tc: number; blocks: Uint8Array[] }[], scale = 1_000_000): Uint8Array {
  return concat(
    el(0x1a45dfa3, el(0x4282, enc.encode("webm"))),
    el(0x18538067, [
      el(0x1549a966, el(0x2ad7b1, uint(scale))),
      el(0x1654ae6b, el(0xae, [
        el(0xd7, uint(1, 1)), el(0x83, uint(1, 1)), el(0x86, enc.encode("V_VP8")),
        el(0xe0, [el(0xb0, uint(720, 2)), el(0xba, uint(1280, 2))]),
      ])),
      ...clusters.map((c) => el(0x1f43b675, [el(0xe7, uint(c.tc)), ...c.blocks], "unknown")),
    ], "unknown"),
  );
}

describe("parseWebM", () => {
  it("reads codec, size and every frame with its timestamp (MediaRecorder layout)", () => {
    const file = webm([
      { tc: 0, blocks: [block(0, true, [1]), block(17, false, [2]), block(33, false, [3])] },
      { tc: 50, blocks: [block(0, false, [4]), block(16, false, [5, 6])] },
    ]);
    const v = parseWebM(file)!;
    expect(v.codec).toBe("V_VP8");
    expect([v.width, v.height]).toEqual([720, 1280]);
    expect(v.frames.map((f) => f.t)).toEqual([0, 0.017, 0.033, 0.05, 0.066]);
    expect(v.frames.map((f) => f.key)).toEqual([true, false, false, false, false]);
    expect([...v.frames[4].data]).toEqual([5, 6]);
  });

  it("applies the timecode scale and negative relative timecodes", () => {
    const v = parseWebM(webm([{ tc: 1000, blocks: [block(0, true, [1]), block(-10, false, [2])] }], 100_000))!;
    expect(v.frames.map((f) => f.t)).toEqual([0.1, 0.099]);
  });

  it("ignores a truncated last frame", () => {
    const file = webm([{ tc: 0, blocks: [block(0, true, [1]), block(20, false, [2, 3, 4])] }]);
    expect(parseWebM(file.slice(0, file.length - 2))!.frames).toHaveLength(1);
  });

  it("returns null for something that isn't WebM", () => {
    expect(parseWebM(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
  });
});
