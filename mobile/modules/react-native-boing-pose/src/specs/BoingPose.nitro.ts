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
  /**
   * Frame rate from the shortest frame gaps (5th percentile): the recording rate of
   * variable-frame-rate files, whose average is lower.
   */
  peakFps: number
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

/** Where the time of one `analyzeVideo` call went, for the diagnostics (milliseconds). */
export interface AnalyzeTiming {
  /** Loading the pose model; 0 when a prepared one was ready (see `prepare`). */
  openMs: number
  /** Decoding and converting frames; runs alongside the pose inference. */
  decodeMs: number
  /** Pose inference. */
  poseMs: number
  /** The whole call. */
  totalMs: number
  /** Frames decoded, including those before `from` back to the key frame. */
  decoded: number
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
  timing: AnalyzeTiming
}

/** A pose landmarker in VIDEO mode, for the live camera. One per camera session. */
export interface PoseDetector
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** "GPU" or "CPU". */
  readonly delegate: string
  /**
   * Minimum seconds between analysed frames (0: every frame). `detect` returns an empty array for
   * frames skipped because of it.
   */
  minInterval: number
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
  /**
   * Loads a pose model in the background for the next `analyzeVideo` with the same model and
   * `preferGpu`, so that call doesn't wait for it. Each such call gets a fresh landmarker (no state
   * from earlier videos) and a new one is loaded after it, until `releasePrepared`.
   */
  prepare(modelPath: string, preferGpu: boolean): void
  /** Frees the model loaded by `prepare`. */
  releasePrepared(): void
  videoInfo(path: string): VideoInfo
  /**
   * The report of the last crash (stack trace, time, device), or "" when there was none.
   * Android: uncaught exceptions on any thread are recorded; native signals (SIGSEGV) are not.
   */
  lastCrash(): string
  clearCrash(): void
  /** Decodes a video file and runs pose on the frames in [from, to] with their own timestamps. */
  analyzeVideo(
    path: string,
    options: AnalyzeOptions,
    onProgress: (fraction: number) => void
  ): Promise<AnalyzeResult>
}
