import { NitroModules } from 'react-native-nitro-modules'
import type { BoingPose } from './specs/BoingPose.nitro'

export type {
  AnalyzeOptions,
  AnalyzeResult,
  BoingPose,
  PoseDetector,
  VideoInfo,
} from './specs/BoingPose.nitro'

/** Native pose detection (MediaPipe) for camera frames and video files. */
export const boingPose = NitroModules.createHybridObject<BoingPose>('BoingPose')
