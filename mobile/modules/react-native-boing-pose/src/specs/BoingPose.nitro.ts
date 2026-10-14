import type { HybridObject } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera'

/** Size, timing and orientation of a video file. Sizes are as displayed (rotation applied). */
export interface VideoInfo {
  width: number
  height: number
  /** Seconds. */
  duration: number
  /** Number of video samples (frames) in the file. */
  frameCount: number
  /** Average frames per second of the file's own timeline. */
  fps: number
  /** Frame rate the camera captured at (Android slow motion), or 0 when the file doesn't say. */
  captureFps: number
  /** Degrees the stored frames must be rotated clockwise to display upright. */
  rotation: number
}

export interface AnalyzeOptions {
  /** Path to a MediaPipe pose landmarker `.task` model file. */
  modelPath: string
  /** Seconds on the file's timeline; frames before `from` and after `to` are decoded but not analysed. */
  from: number
  to: number
  /** Minimum seconds between analysed frames; 0 analyses every frame. */
  minInterval: number
  /** Try the GPU first (falls back to the CPU). */
  preferGpu: boolean
}

/** Pose of every analysed frame of a video. */
export interface AnalyzeResult {
  width: number
  height: number
  /** Presentation time of each analysed frame, seconds on the file's timeline. */
  times: number[]
  /** 1 where a person was found in that frame, else 0 (numbers: Nitro can't pass boolean arrays). */
  found: number[]
  /** 33 landmarks × (x, y, z, visibility) per frame, flat; zeros where nothing was found. */
  landmarks: number[]
  /** "GPU" or "CPU". */
  delegate: string
}

/** A pose landmarker in VIDEO mode, for the live camera. One per camera session. */
export interface PoseDetector
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** "GPU" or "CPU". */
  readonly delegate: string
  /**
   * Pose in a camera frame (synchronous, for the frame-output worklet).
   * Returns [t, width, height] followed by 33 × (x, y, z, visibility) when a person was found;
   * t is the frame's presentation time in seconds, width/height the upright frame size.
   */
  detect(frame: Frame): number[]
  /** Frees the model. */
  close(): void
}

export interface BoingPose
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  createDetector(modelPath: string, preferGpu: boolean): PoseDetector
  videoInfo(path: string): VideoInfo
  /** Decodes a video file and runs pose on the frames in [from, to] with their own timestamps. */
  analyzeVideo(
    path: string,
    options: AnalyzeOptions,
    onProgress: (fraction: number) => void
  ): Promise<AnalyzeResult>
}
