/** Snap jittery frame times to a regular grid (frames counted by rounding gaps to the median step). */
export function dejitter(t: number[]): number[] {
  if (t.length < 3) return t;
  const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  const step0 = gaps[gaps.length >> 1];
  // Frame index of each timestamp: dropped frames show as gaps of ≈ 2, 3 … steps.
  const idx = [0];
  for (let i = 1; i < t.length; i++) idx.push(idx[i - 1] + Math.max(1, Math.round((t[i] - t[i - 1]) / step0)));
  // Least-squares line t ≈ a + b·idx.
  const n = t.length, mi = idx.reduce((s, x) => s + x, 0) / n, mt = t.reduce((s, x) => s + x, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (idx[i] - mi) * (t[i] - mt); sxx += (idx[i] - mi) ** 2; }
  const b = sxy / sxx;
  return idx.map((k) => mt + b * (k - mi));
}
