import { Directory, File, Paths } from "expo-file-system";

export type ModelKind = "lite" | "full" | "heavy";

/** The same MediaPipe pose models as the web app. */
const modelUrl = (k: ModelKind) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${k}/float16/latest/pose_landmarker_${k}.task`;

const pending: Partial<Record<ModelKind, Promise<string>>> = {};

/**
 * Local path of a pose model, downloaded on first use and kept. `onStep` gets
 * human-readable progress for the status line.
 */
export function modelPath(kind: ModelKind, onStep: (text: string) => void = () => {}): Promise<string> {
  return (pending[kind] ??= download(kind, onStep).catch((e) => {
    delete pending[kind]; // allow a retry
    throw e;
  }));
}

async function download(kind: ModelKind, onStep: (text: string) => void): Promise<string> {
  const dir = new Directory(Paths.document, "models");
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, `pose_landmarker_${kind}.task`);
  if (file.exists && file.size > 0) return file.uri;
  const part = new File(dir, `pose_landmarker_${kind}.task.part`);
  if (part.exists) part.delete();
  const mb = (n: number) => (n / 1e6).toFixed(1);
  onStep("Loading pose model…");
  await File.downloadFileAsync(modelUrl(kind), part, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) =>
      onStep(totalBytes > 0 ? `Loading pose model · ${mb(bytesWritten)} of ${mb(totalBytes)} MB` : "Loading pose model…"),
  });
  part.moveSync(file);
  return file.uri;
}

/** File-system path (no file:// prefix) for native code. */
export const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

/** Deletes a file if it's there; never throws (cleanup must not hide the real error). */
export function deleteQuietly(uri: string): void {
  try {
    const f = new File(uri.startsWith("file://") ? uri : `file://${uri}`);
    if (f.exists) f.delete();
  } catch {
    // already gone or not ours
  }
}
