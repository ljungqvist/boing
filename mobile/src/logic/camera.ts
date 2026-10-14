/** Highest frame rate a camera offers, capped (240 is as fast as the analysis needs). */
export function bestFps(ranges: { min: number; max: number }[], cap = 240): number {
  const maxes = ranges.map((r) => Math.min(r.max, cap)).filter((x) => x > 0);
  return maxes.length ? Math.max(...maxes) : 30;
}
