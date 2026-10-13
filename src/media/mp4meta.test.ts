import { describe, expect, it } from "vitest";
import { captureFps, slowMotionTimeScale } from "./mp4meta";

const enc = new TextEncoder();

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const len = 8 + payload.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(enc.encode(type), 4);
  let o = 8;
  for (const p of payload) { out.set(p, o); o += p.length; }
  return out;
}
const u32 = (...v: number[]) => { const b = new Uint8Array(4 * v.length); v.forEach((x, i) => new DataView(b.buffer).setUint32(4 * i, x)); return b; };
const f32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v); return b; };

/** moov/meta with mdta keys and one float value per key. */
function mp4(entries: Record<string, number>): ArrayBuffer {
  const names = Object.keys(entries);
  const keys = box("keys", u32(0, names.length), ...names.map((n) => box("mdta", enc.encode(n))));
  const items = names.map((n, i) => {
    const item = box("data", u32(23, 0), f32(entries[n]));
    const b = box("xxxx", item);
    new DataView(b.buffer).setUint32(4, i + 1); // item type = 1-based key index
    return b;
  });
  const hdlr = box("hdlr", u32(0, 0), enc.encode("mdta"), new Uint8Array(13));
  const file = new Uint8Array([...box("ftyp", enc.encode("isom")), ...box("moov", box("meta", hdlr, keys, box("ilst", ...items))), ...box("mdat", new Uint8Array(16))]);
  return file.buffer;
}

describe("captureFps", () => {
  it("reads com.android.capture.fps", () => {
    expect(captureFps(mp4({ "com.android.capture.fps": 120 }))).toBe(120);
  });
  it("finds it among other keys", () => {
    expect(captureFps(mp4({ "com.android.version": 16, "com.android.capture.fps": 240 }))).toBe(240);
  });
  it("returns null without metadata", () => {
    expect(captureFps(mp4({}))).toBeNull();
    expect(captureFps(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });
});

describe("slowMotionTimeScale", () => {
  const times = (dt: number, n = 100) => Array.from({ length: n }, (_, i) => i * dt);
  it("slow motion: 120 fps captured, 30 fps playback", () => {
    expect(slowMotionTimeScale(120, times(1 / 30))).toBeCloseTo(0.25, 6);
  });
  it("variable frame rate is not slow motion", () => {
    const t = [...times(1 / 30, 50), ...times(1 / 60, 50).map((x) => x + 2)];
    expect(slowMotionTimeScale(60, t)).toBeUndefined();
  });
  it("normal video", () => {
    expect(slowMotionTimeScale(30, times(1 / 30))).toBeUndefined();
    expect(slowMotionTimeScale(null, times(1 / 30))).toBeUndefined();
  });
});
