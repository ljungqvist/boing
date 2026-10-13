import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "../analysis/types";
import { fetchWithProgress, withTimeout } from "./load";

export type ModelKind = "lite" | "full" | "heavy";

const modelUrl = (k: ModelKind) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${k}/float16/latest/pose_landmarker_${k}.task`;

/** MediaPipe pose landmarker in VIDEO mode; one person. */
export class Pose {
  private lastMs = -1;

  private constructor(private readonly landmarker: PoseLandmarker, readonly delegate: "GPU" | "CPU", readonly kind: ModelKind) {}

  /** Load engine + model; `onStep` gets human-readable progress for the status line. */
  static async create(kind: ModelKind, onStep: (text: string) => void = () => {}): Promise<Pose> {
    // Download engine and model ourselves (with progress, cached), so the timeout
    // below only measures the start-up, never a slow mobile connection.
    const mb = (n: number) => (n / 1e6).toFixed(1);
    const name = (await FilesetResolver.isSimdSupported()) ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
    const base = new URL("mediapipe/", document.baseURI).href;
    const engine = await fetchWithProgress(`${base}${name}.wasm?v=${__MEDIAPIPE_VERSION__}`, (got, total) =>
      onStep(`Loading pose engine · ${mb(got)} of ${mb(total)} MB`));
    const fileset = {
      wasmLoaderPath: `${base}${name}.js`,
      wasmBinaryPath: URL.createObjectURL(new Blob([engine], { type: "application/wasm" })),
    };
    const model = await fetchWithProgress(modelUrl(kind), (got, total) =>
      onStep(`Loading pose model · ${mb(got)} of ${mb(total)} MB`));
    // Some phones hang while setting up the GPU; fall back to the CPU instead of waiting forever.
    for (const delegate of ["GPU", "CPU"] as const) {
      onStep(delegate === "GPU" ? "Starting pose model…" : "Starting pose model (without GPU)…");
      try {
        const lm = await withTimeout(PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        }), delegate === "GPU" ? 15_000 : 60_000, `Starting the pose model (${delegate})`);
        return new Pose(lm, delegate, kind);
      } catch (e) {
        if (delegate === "CPU") throw e;
        console.warn("GPU delegate failed, falling back to CPU", e);
      }
    }
    throw new Error("unreachable");
  }

  /** Landmarks of the current frame; `tMs` is the frame's own timestamp. */
  detect(source: HTMLVideoElement, tMs: number): Landmark[] | null {
    const ms = Math.max(Math.round(tMs), this.lastMs + 1); // must strictly increase
    this.lastMs = ms;
    const r = this.landmarker.detectForVideo(source, ms);
    const p = r.landmarks[0];
    return p ? p.map((q) => [q.x, q.y, q.z, q.visibility ?? 0] as Landmark) : null;
  }

  /** Start a new timeline (e.g. a new video file). */
  resetClock(): void {
    this.lastMs = -1;
  }

  close(): void {
    this.landmarker.close();
  }
}
