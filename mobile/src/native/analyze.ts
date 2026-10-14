import { boingPose } from "react-native-boing-pose";
import { toFrames } from "../logic/pose";
import type { Analyze } from "../logic/video";
import { toPath } from "./models";

/** `Analyze` backed by the native decoder + MediaPipe, for one video file and model. */
export function nativeAnalyzer(videoUri: string, modelUri: string): Analyze {
  const path = toPath(videoUri);
  const modelPath = toPath(modelUri);
  return async ({ from, to, minInterval }, onProgress) => {
    const r = await boingPose.analyzeVideo(path, { modelPath, from, to, minInterval, preferGpu: true }, onProgress);
    return { frames: toFrames(r), size: { width: r.width, height: r.height } };
  };
}
