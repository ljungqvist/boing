/**
 * Read the capture frame rate Android writes into MP4 metadata
 * (`moov/meta` with mdta `keys` + `ilst`, key `com.android.capture.fps`).
 * Port of tools/mp4meta.py for the browser.
 */

interface Box { type: string; start: number; end: number }

function* boxes(v: DataView, off: number, end: number): Generator<Box> {
  while (off + 8 <= end) {
    let size = v.getUint32(off);
    let hdr = 8;
    if (size === 1) { size = Number(v.getBigUint64(off + 8)); hdr = 16; }
    else if (size === 0) size = end - off;
    if (size < hdr || off + size > end) return;
    const type = String.fromCharCode(v.getUint8(off + 4), v.getUint8(off + 5), v.getUint8(off + 6), v.getUint8(off + 7));
    yield { type, start: off + hdr, end: off + size };
    off += size;
  }
}

function find(v: DataView, start: number, end: number, path: string[]): Box | null {
  for (const b of boxes(v, start, end)) {
    if (b.type === path[0]) return path.length === 1 ? b : find(v, b.start, b.end, path.slice(1));
  }
  return null;
}

/** mdta metadata as key → number | string. */
export function mdtaMetadata(buf: ArrayBuffer): Record<string, number | string> {
  const v = new DataView(buf);
  const meta = find(v, 0, buf.byteLength, ["moov", "meta"]);
  if (!meta) return {};
  let start = meta.start;
  if (start + 8 <= meta.end && String.fromCharCode(...new Uint8Array(buf, start + 4, 4)) !== "hdlr") start += 4;
  const keys: string[] = [];
  const out: Record<string, number | string> = {};
  const dec = new TextDecoder();
  for (const b of boxes(v, start, meta.end)) {
    if (b.type === "keys") {
      const n = v.getUint32(b.start + 4);
      let o = b.start + 8;
      for (let i = 0; i < n && o + 8 <= b.end; i++) {
        const sz = v.getUint32(o);
        keys.push(dec.decode(new Uint8Array(buf, o + 8, sz - 8)));
        o += sz;
      }
    } else if (b.type === "ilst") {
      for (const item of boxes(v, b.start, b.end)) {
        const idx = v.getUint32(item.start - 4);
        const key = keys[idx - 1];
        if (!key) continue;
        for (const d of boxes(v, item.start, item.end)) {
          if (d.type !== "data") continue;
          const code = v.getUint32(d.start) & 0xffffff;
          const len = d.end - d.start - 8;
          if (code === 23 && len === 4) out[key] = v.getFloat32(d.start + 8);
          else if ((code === 21 || code === 22) && len <= 4) out[key] = Number(readUint(v, d.start + 8, len));
          else out[key] = dec.decode(new Uint8Array(buf, d.start + 8, len));
        }
      }
    }
  }
  return out;
}

function readUint(v: DataView, off: number, len: number): number {
  let x = 0;
  for (let i = 0; i < len; i++) x = x * 256 + v.getUint8(off + i);
  return x;
}

export function captureFps(buf: ArrayBuffer): number | null {
  try {
    const fps = mdtaMetadata(buf)["com.android.capture.fps"];
    return typeof fps === "number" && fps > 0 ? fps : null;
  } catch {
    return null;
  }
}

/**
 * Real seconds per file second for a slow-motion file, else undefined.
 * Variable-frame-rate recordings also report a high capture fps (their maximum),
 * but their shortest frame gaps already match it.
 */
export function slowMotionTimeScale(capture: number | null, frameTimes: number[]): number | undefined {
  if (!capture || frameTimes.length < 2) return undefined;
  const gaps = frameTimes.slice(1).map((t, i) => t - frameTimes[i]).sort((a, b) => a - b);
  const playbackFps = 1 / gaps[Math.floor(gaps.length / 20)];
  return capture > 1.5 * playbackFps ? playbackFps / capture : undefined;
}
