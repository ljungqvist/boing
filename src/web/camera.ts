export type Facing = "user" | "environment";

export interface CameraSession {
  stop(): void;
  /** Which frame timestamp the browser provides, and how often it failed to advance. */
  timing: { source: "captureTime" | "mediaTime" | "none"; stalled: number };
  /** Frame rate the camera reports, if any. */
  reportedFps?: number;
  label: string;
}

/**
 * Start the camera and call `onFrame` for every frame the browser presents,
 * with the frame's capture time in seconds.
 */
export async function startCamera(
  video: HTMLVideoElement,
  facing: Facing,
  onFrame: (t: number, dropped: number) => void,
): Promise<CameraSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // A smaller picture is enough (the pose model works at 256 px) and keeps slow phones fast.
    // Keep 16:9: asking for another shape can make the camera crop the picture (feet!).
    video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 60 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  let running = true;
  const timing: CameraSession["timing"] = { source: "none", stalled: 0 };
  let lastPresented = -1;
  let lastT = -Infinity;
  const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (!running) return;
    // Prefer the capture timestamp; fall back to the media time.
    let t = meta.captureTime !== undefined ? meta.captureTime / 1000 : meta.mediaTime;
    timing.source = meta.captureTime !== undefined ? "captureTime" : "mediaTime";
    if (!(t > lastT)) {
      timing.stalled++;
      t = lastT + 1e-3;
    }
    lastT = t;
    const dropped = lastPresented < 0 ? 0 : Math.max(0, meta.presentedFrames - lastPresented - 1);
    lastPresented = meta.presentedFrames;
    onFrame(t, dropped);
    video.requestVideoFrameCallback(tick);
  };
  video.requestVideoFrameCallback(tick);

  const track = stream.getVideoTracks()[0];
  return {
    reportedFps: track.getSettings().frameRate,
    timing,
    label: track.label,
    stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
