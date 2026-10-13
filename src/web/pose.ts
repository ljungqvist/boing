import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "../analysis/types";

export type ModelKind = "lite" | "full" | "heavy";

const modelUrl = (k: ModelKind) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${k}/float16/latest/pose_landmarker_${k}.task`;

/** MediaPipe pose landmarker in VIDEO mode; one person. */
export class Pose {
  private lastMs = -1;

  private constructor(private readonly landmarker: PoseLandmarker, readonly delegate: "GPU" | "CPU", readonly kind: ModelKind) {}

  static async create(kind: ModelKind): Promise<Pose> {
    const fileset = await FilesetResolver.forVisionTasks(new URL("mediapipe", document.baseURI).href);
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const lm = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl(kind), delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
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
