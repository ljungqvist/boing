import { captureFps, slowMotionTimeScale } from "../media/mp4meta";

export interface FileResult {
  frameCount: number;
  /** Real seconds per file second (slow motion), else undefined. */
  timeScale?: number;
  captureFps: number | null;
}

export interface VideoWindow {
  /** Hand over frames from this media time on (seconds); earlier ones are fast-forwarded. */
  from?: number;
  /** Stop after this media time. */
  to?: number;
}

/**
 * Step through every frame of a video file: pause at each presented frame,
 * hand it to `onFrame`, then continue. Slower than real time but skips nothing.
 */
export async function processFile(
  file: File,
  video: HTMLVideoElement,
  onFrame: (t: number) => void,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<FileResult> {
  const capture = captureFps(await file.arrayBuffer());
  const { times } = await processVideo(file, video, onFrame, onProgress, signal);
  return { frameCount: times.length, captureFps: capture, timeScale: slowMotionTimeScale(capture, times) };
}

/** Fast-forward speed before the window; frames skipped there don't matter. */
const FAST_RATE = 8;
/** Switch to frame stepping this many media seconds before the window starts. */
const FAST_LEAD = 0.6;

/**
 * Like `processFile`, for any playable Blob (e.g. a MediaRecorder piece) and optionally only
 * a window of it. Never seeks (MediaRecorder WebM has no index): always plays from the start.
 */
export async function processVideo(
  source: Blob,
  video: HTMLVideoElement,
  onFrame: (t: number) => void,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  win: VideoWindow = {},
): Promise<{ frameCount: number; times: number[] }> {
  const from = win.from ?? -Infinity, to = win.to ?? Infinity;
  const url = URL.createObjectURL(source);
  video.srcObject = null;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  const times: number[] = [];
  try {
    await new Promise<void>((ok, fail) => {
      video.onloadedmetadata = () => ok();
      video.onerror = () => fail(new Error("cannot play this video in the browser"));
      signal.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")), { once: true });
    });
    let stepping = !(from - FAST_LEAD > 0);
    video.playbackRate = stepping ? 1 : FAST_RATE;
    await new Promise<void>((done, fail) => {
      const step = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (signal.aborted) return fail(new DOMException("aborted", "AbortError"));
        const t = meta.mediaTime;
        if (!stepping) {
          if (t < from - FAST_LEAD) {
            video.requestVideoFrameCallback(step);
            return; // keep playing fast
          }
          stepping = true;
          video.playbackRate = 1;
        }
        video.pause();
        if (t > to) return done();
        if (t >= from && (times.length === 0 || t > times[times.length - 1])) {
          times.push(t);
          onFrame(t);
        }
        const span = Number.isFinite(to) ? to - Math.max(0, from) : video.duration;
        onProgress(span && Number.isFinite(span) ? Math.min(1, Math.max(0, (t - Math.max(0, from)) / span)) : 0);
        if (video.ended) return done();
        video.requestVideoFrameCallback(step);
        play();
      };
      // A pause() in the next frame callback can interrupt play() (AbortError): that's expected.
      const play = () => video.play().catch((e) => { if ((e as Error).name !== "AbortError") fail(e); });
      video.onended = () => done();
      signal.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")), { once: true });
      video.requestVideoFrameCallback(step);
      play();
    });
  } finally {
    video.onended = null;
    video.onerror = null;
    video.pause();
    video.playbackRate = 1;
    URL.revokeObjectURL(url);
  }
  return { frameCount: times.length, times };
}
