import { captureFps, slowMotionTimeScale } from "../media/mp4meta";

export interface FileResult {
  frameCount: number;
  /** Real seconds per file second (slow motion), else undefined. */
  timeScale?: number;
  captureFps: number | null;
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
  const url = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((ok, fail) => {
    video.onloadedmetadata = () => ok();
    video.onerror = () => fail(new Error("cannot play this video in the browser"));
  });

  const times: number[] = [];
  try {
    await new Promise<void>((done, fail) => {
      const step = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (signal.aborted) return fail(new DOMException("aborted", "AbortError"));
        video.pause();
        const t = meta.mediaTime;
        if (times.length === 0 || t > times[times.length - 1]) {
          times.push(t);
          onFrame(t);
        }
        onProgress(video.duration ? t / video.duration : 0);
        if (video.ended) return done();
        video.requestVideoFrameCallback(step);
        video.play().catch(fail);
      };
      video.onended = () => done();
      video.requestVideoFrameCallback(step);
      video.play().catch(fail);
    });
  } finally {
    video.onended = null;
    URL.revokeObjectURL(url);
  }
  return { frameCount: times.length, captureFps: capture, timeScale: slowMotionTimeScale(capture, times) };
}
