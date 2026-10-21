/**
 * Phone motion around a jump, from the accelerometer (in g, including gravity) and the gyroscope
 * (rad/s). Sample times are seconds on the sensor clock, which on Android is the camera's frame
 * clock (time since boot), so they line up with the jump's times.
 */

/** [t, x, y, z] in the phone's axes: x right, y up along the screen, z out of the screen. */
export type Sample = [number, number, number, number];

/** The last `keepSeconds` of samples of one sensor. */
export class SampleBuffer {
  private samples: Sample[] = [];

  constructor(private readonly keepSeconds = 60) {}

  add(s: Sample): void {
    this.samples.push(s);
    const from = s[0] - this.keepSeconds;
    let k = 0;
    while (k < this.samples.length && this.samples[k][0] < from) k++;
    if (k > 0) this.samples.splice(0, k);
  }

  /** Samples between `from` and `to`, rounded for storage. */
  window(from: number, to: number): Sample[] {
    const r = (x: number) => Math.round(x * 1e4) / 1e4;
    return this.samples.filter((s) => s[0] >= from && s[0] <= to).map(([t, x, y, z]) => [Math.round(t * 1e4) / 1e4, r(x), r(y), r(z)]);
  }
}

export interface MotionSummary {
  /** Leaning back from upright (screen tilted up), degrees; 0 = standing straight, 90 = lying on its back. */
  tiltDeg: number;
  /** Leaning sideways, degrees. */
  rollDeg: number;
  /** The phone stood upside down (reverse portrait). */
  upsideDown: boolean;
  /** Fastest turn of the phone from just before takeoff to after landing, degrees per second. */
  turnMaxDegS: number;
  /** Largest acceleration beyond gravity in that time (a knock or the floor shaking), g. */
  shakeMaxG: number;
}

const DEG = 180 / Math.PI;
const mean = (xs: Sample[], k: number) => xs.reduce((a, s) => a + s[k], 0) / xs.length;

/** How the phone stood and whether it moved, around a jump from `tOff` to `tOn`. Null without samples. */
export function motionSummary(acc: Sample[], gyro: Sample[], tOff: number, tOn: number): MotionSummary | null {
  // Gravity while the person stood still before the jump (the phone shouldn't move then either).
  let still = acc.filter((s) => s[0] >= tOff - 1 && s[0] <= tOff - 0.3);
  if (still.length < 3) still = acc;
  if (still.length === 0) return null;
  const [gx, gy, gz] = [mean(still, 1), mean(still, 2), mean(still, 3)];
  const during = (s: Sample) => s[0] >= tOff - 0.3 && s[0] <= tOn + 0.5;
  const turn = gyro.filter(during).map(([, x, y, z]) => Math.hypot(x, y, z) * DEG);
  const shake = acc.filter(during).map(([, x, y, z]) => Math.hypot(x - gx, y - gy, z - gz));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    tiltDeg: r1(Math.atan2(gz, Math.abs(gy)) * DEG),
    rollDeg: r1(Math.atan2(gx, Math.abs(gy)) * DEG),
    upsideDown: gy < 0,
    turnMaxDegS: r1(turn.length ? Math.max(...turn) : 0),
    shakeMaxG: Math.round((shake.length ? Math.max(...shake) : 0) * 1000) / 1000,
  };
}
