import { parseWebM } from "../media/webm";
import type { VideoWindow } from "./file";

/** WebCodecs codec strings for the Matroska codec IDs MediaRecorder writes. */
const CODECS: Record<string, string> = { V_VP8: "vp8", V_VP9: "vp09.00.10.08" };
/** Encoded chunks waiting in the decoder before we wait for it. */
const MAX_QUEUE = 4;

const aborted = () => new DOMException("aborted", "AbortError");
const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/**
 * Decode a MediaRecorder WebM with WebCodecs and hand every frame within the window to
 * `onFrame`, with the container's own timestamp (seconds). Unlike stepping a `<video>`,
 * this never skips a frame, however busy the page is. Resolves to null when this browser
 * or file can't be decoded this way (use `processVideo` instead).
 */
export async function decodeWebM(
  source: Blob,
  onFrame: (frame: VideoFrame, t: number) => void,
  signal: AbortSignal,
  win: VideoWindow = {},
): Promise<{ frameCount: number; width: number; height: number } | null> {
  if (typeof VideoDecoder === "undefined") return null;
  const video = parseWebM(new Uint8Array(await source.arrayBuffer()));
  const codec = video && CODECS[video.codec];
  if (!video || !codec) return null;
  const config: VideoDecoderConfig = { codec, codedWidth: video.width || undefined, codedHeight: video.height || undefined };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) return null;

  const from = win.from ?? -Infinity, to = win.to ?? Infinity;
  const firstKey = video.frames.findIndex((f) => f.key);
  if (firstKey < 0) return null;
  const chunks = video.frames.slice(firstKey);
  const lastNeeded = chunks.findIndex((f) => f.t > to);
  if (lastNeeded >= 0) chunks.length = lastNeeded + 1;

  const ready: VideoFrame[] = [];
  let failure: unknown = null;
  const decoder = new VideoDecoder({ output: (f) => ready.push(f), error: (e) => (failure = e) });
  let frameCount = 0, width = video.width, height = video.height;
  const drain = async () => {
    while (ready.length) {
      const frame = ready.shift()!;
      try {
        const t = frame.timestamp / 1e6;
        if (t >= from && t <= to) {
          width = frame.displayWidth;
          height = frame.displayHeight;
          frameCount++;
          onFrame(frame, t);
        }
      } finally {
        frame.close();
      }
      if (signal.aborted) throw aborted();
      await yieldToPage(); // let the live preview run between frames
    }
  };
  try {
    decoder.configure(config);
    for (const c of chunks) {
      if (signal.aborted) throw aborted();
      if (failure) throw failure;
      decoder.decode(new EncodedVideoChunk({ type: c.key ? "key" : "delta", timestamp: Math.round(c.t * 1e6), data: c.data }));
      await drain();
      while (decoder.decodeQueueSize > MAX_QUEUE && !failure) {
        await new Promise((r) => setTimeout(r, 2));
        await drain();
      }
    }
    await decoder.flush();
    if (failure) throw failure;
    await drain();
  } finally {
    ready.forEach((f) => f.close());
    if (decoder.state !== "closed") decoder.close();
  }
  return { frameCount, width, height };
}
