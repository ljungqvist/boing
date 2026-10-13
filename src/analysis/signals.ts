import type { Landmark, PoseVideo, Signals } from "./types";

// MediaPipe pose landmark indices.
const NOSE = 0;
const HIPS = [23, 24];
const HEELS = [29, 30];
const TOES = [31, 32]; // "foot index"

export interface SignalOptions {
  /** Landmarks below this visibility are treated as missing. */
  minVisibility?: number;
}

export function toSignals(video: PoseVideo, opts: SignalOptions = {}): Signals {
  const minVis = opts.minVisibility ?? 0.5;
  const H = video.height;
  const s: Signals = { t: [], hip: [], toe: [], bodyPx: [] };

  // Mean image-y (0–1, down) of the given points, NaN if any is unusable.
  const meanY = (lm: Landmark[] | null, idx: number[]) => {
    if (!lm) return NaN;
    let sum = 0;
    for (const i of idx) {
      if (lm[i][3] < minVis) return NaN;
      sum += lm[i][1];
    }
    return sum / idx.length;
  };
  const up = (y: number) => H - y * H;

  for (const f of video.frames) {
    s.t.push(f.t);
    s.hip.push(up(meanY(f.lm, HIPS)));
    s.toe.push(up(meanY(f.lm, TOES)));
    s.bodyPx.push((meanY(f.lm, HEELS) - meanY(f.lm, [NOSE])) * H);
  }
  return s;
}
