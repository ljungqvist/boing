/**
 * Minimal WebM (Matroska) demuxer for MediaRecorder output: the video track's codec,
 * size and every frame with its container timestamp. MediaRecorder writes the Segment
 * and Clusters with unknown sizes and no index, so the file is scanned element by element.
 */

export interface WebMFrame {
  /** Seconds from the start of the recording. */
  t: number;
  key: boolean;
  data: Uint8Array;
}

export interface WebMVideo {
  /** Matroska codec ID, e.g. "V_VP8". */
  codec: string;
  width: number;
  height: number;
  frames: WebMFrame[];
}

const EBML = 0x1a45dfa3;
/** Containers we descend into instead of skipping. */
const MASTER = new Set([
  0x18538067, // Segment
  0x1549a966, // Info
  0x1654ae6b, // Tracks
  0xae, // TrackEntry
  0xe0, // Video
  0x1f43b675, // Cluster
  0xa0, // BlockGroup
]);
const TIMECODE_SCALE = 0x2ad7b1;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const CLUSTER_TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;

/** Variable-length integer at `o`: [value, length], value −1 for "unknown size"; null if cut off. */
function vint(b: Uint8Array, o: number, keepMarker: boolean): [number, number] | null {
  if (o >= b.length || b[o] === 0) return null;
  let len = 1;
  while (!(b[o] & (0x80 >> (len - 1)))) len++;
  if (o + len > b.length) return null;
  let v = keepMarker ? b[o] : b[o] & (0xff >> len);
  let allOnes = v === (0xff >> len);
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    allOnes &&= b[o + i] === 0xff;
  }
  return [!keepMarker && allOnes ? -1 : v, len];
}

const uint = (b: Uint8Array) => b.reduce((v, x) => v * 256 + x, 0);

export function parseWebM(b: Uint8Array): WebMVideo | null {
  const first = vint(b, 0, true);
  if (!first || first[0] !== EBML) return null;

  let scale = 1_000_000; // ns per timecode unit
  let clusterTc = 0;
  const tracks: { number: number; type?: number; codec?: string; width?: number; height?: number }[] = [];
  const blocks: { track: number; tc: number; key: boolean; data: Uint8Array }[] = [];

  let o = 0;
  while (o < b.length) {
    const id = vint(b, o, true);
    if (!id) break;
    const size = vint(b, o + id[1], false);
    if (!size) break;
    const start = o + id[1] + size[1];
    if (MASTER.has(id[0])) {
      o = start;
      continue;
    }
    if (size[0] < 0 || start + size[0] > b.length) break; // unknown size or cut off
    const data = b.subarray(start, start + size[0]);
    const track = tracks[tracks.length - 1];
    switch (id[0]) {
      case TIMECODE_SCALE: scale = uint(data); break;
      case TRACK_NUMBER: tracks.push({ number: uint(data) }); break;
      case TRACK_TYPE: if (track) track.type = uint(data); break;
      case CODEC_ID: if (track) track.codec = new TextDecoder().decode(data).replace(/\0+$/, ""); break;
      case PIXEL_WIDTH: if (track) track.width = uint(data); break;
      case PIXEL_HEIGHT: if (track) track.height = uint(data); break;
      case CLUSTER_TIMECODE: clusterTc = uint(data); break;
      case SIMPLE_BLOCK:
      case BLOCK: {
        const tn = vint(data, 0, false);
        if (!tn || data.length < tn[1] + 3) break;
        const flags = data[tn[1] + 2];
        if (flags & 0x06) break; // laced frames: not written by MediaRecorder for video
        const rel = new DataView(data.buffer, data.byteOffset + tn[1], 2).getInt16(0);
        const key = id[0] === SIMPLE_BLOCK ? !!(flags & 0x80) : blocks.length === 0;
        blocks.push({ track: tn[0], tc: clusterTc + rel, key, data: data.subarray(tn[1] + 3) });
        break;
      }
    }
    o = start + size[0];
  }

  const video = tracks.find((t) => t.type === 1) ?? tracks[0];
  if (!video?.codec) return null;
  return {
    codec: video.codec,
    width: video.width ?? 0,
    height: video.height ?? 0,
    frames: blocks.filter((x) => x.track === video.number).map((x) => ({ t: (x.tc * scale) / 1e9, key: x.key, data: x.data })),
  };
}
