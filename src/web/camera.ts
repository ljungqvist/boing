export type Facing = "user" | "environment";

export interface CameraSession {
  stop(): void;
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
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  let running = true;
  let lastPresented = -1;
  let lastT = -Infinity;
  const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (!running) return;
    // Prefer the capture timestamp; fall back to the media time.
    let t = meta.captureTime !== undefined ? meta.captureTime / 1000 : meta.mediaTime;
    if (!(t > lastT)) t = lastT + 1e-3;
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
    label: track.label,
    stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
