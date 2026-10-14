/** One landmark: normalised x, y (0–1, y down), z, visibility. */
export type Landmark = [number, number, number, number];

export interface PoseFrame {
  /** Seconds, from the decoder's presentation timestamp. */
  t: number;
  /** 33 MediaPipe pose landmarks, or null when no person was found. */
  lm: Landmark[] | null;
}

export interface PoseVideo {
  id?: string;
  width: number;
  height: number;
  fps: number;
  /** Real seconds per file second, for slow-motion files (from the capture fps). */
  timeScale?: number;
  frames: PoseFrame[];
}

/** Height-up pixel signals, one entry per frame; NaN where unusable. */
export interface Signals {
  t: number[];
  hip: number[];
  toe: number[];
  /** Vertical nose-to-heel distance in pixels (a body-size proxy). */
  bodyPx: number[];
  /**
   * How far the hips, heels or toes lie outside the picture (fraction of the frame size,
   * 0 when inside); NaN without a person. The head may leave the picture at the apex.
   */
  outside?: number[];
}
