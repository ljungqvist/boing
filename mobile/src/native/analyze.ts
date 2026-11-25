import { boingPose } from "react-native-boing-pose";
import { toFrames } from "../logic/pose";
import type { Analyze } from "../logic/video";
import { toPath } from "./models";

/**
 * `Analyze` backed by the native decoder + MediaPipe, for one video file. `findModel` (lighter)
 * locates the jumps, `measureModel` measures them.
 */
export function nativeAnalyzer(videoUri: string, measureModel: string, findModel = measureModel): Analyze {
  const path = toPath(videoUri);
  return async ({ from, to, minInterval, purpose, perFrame = false }, onProgress) => {
    const modelPath = toPath(purpose === "find" ? findModel : measureModel);
    // Frame by frame, two CPU copies of the model share the frames with the GPU one (as the live re-measurement).
    const r = await boingPose.analyzeVideo(path, { modelPath, from, to, minInterval, preferGpu: true, perFrame, cpuHelpers: perFrame ? 2 : 0 }, onProgress);
    return { frames: toFrames(r), size: { width: r.width, height: r.height } };
  };
}
