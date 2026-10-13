/** y = a·(t − t0)² + b·(t − t0) + c, fitted around t0 = mean(t) for conditioning. */
export interface Quadratic {
  a: number;
  b: number;
  c: number;
  t0: number;
  /** Time of the vertex (apex for a < 0). */
  vertex: number;
  /** Root-mean-square residual of the fit. */
  rms: number;
}

export function fitQuadratic(t: number[], y: number[]): Quadratic {
  const n = t.length;
  if (n < 3 || y.length !== n) throw new Error(`need >= 3 matching points, got ${n}`);
  const t0 = t.reduce((s, v) => s + v, 0) / n;

  // Normal equations for basis [x², x, 1] with x = t − t0.
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = t[i] - t0, x2 = x * x;
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    sy += y[i]; sxy += x * y[i]; sx2y += x2 * y[i];
  }
  const [a, b, c] = solve3(
    [[s4, s3, s2], [s3, s2, s1], [s2, s1, n]],
    [sx2y, sxy, sy],
  );

  let ss = 0;
  for (let i = 0; i < n; i++) {
    const x = t[i] - t0;
    const r = y[i] - (a * x * x + b * x + c);
    ss += r * r;
  }
  return { a, b, c, t0, vertex: t0 - b / (2 * a), rms: Math.sqrt(ss / n) };
}

export function evalQuadratic(q: Quadratic, t: number): number {
  const x = t - q.t0;
  return q.a * x * x + q.b * x + q.c;
}

/** Times where the parabola equals `level`, sorted; null if it never does. */
export function quadraticRoots(q: Quadratic, level: number): [number, number] | null {
  const c = q.c - level;
  const disc = q.b * q.b - 4 * q.a * c;
  if (disc < 0 || q.a === 0) return null;
  const s = Math.sqrt(disc);
  const r1 = (-q.b - s) / (2 * q.a) + q.t0;
  const r2 = (-q.b + s) / (2 * q.a) + q.t0;
  return r1 < r2 ? [r1, r2] : [r2, r1];
}

/** Gaussian elimination with partial pivoting for a 3×3 system. */
function solve3(m: number[][], v: number[]): [number, number, number] {
  const A = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let p = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]];
    if (A[col][col] === 0) throw new Error("singular system (are the times distinct?)");
    for (let r = col + 1; r < 3; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = A[r][3];
    for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return [x[0], x[1], x[2]];
}
