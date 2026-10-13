import { evalQuadratic } from "../analysis/fit";
import type { Jump } from "../analysis/jumps";
import type { Landmark, Signals } from "../analysis/types";

const BONES: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** Skeleton over the video; canvas has the video's intrinsic size. */
export function drawSkeleton(canvas: HTMLCanvasElement, lm: Landmark[] | null, airborne: boolean): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  const W = canvas.width, H = canvas.height;
  ctx.lineWidth = Math.max(2, W / 300);
  ctx.strokeStyle = airborne ? "#f5a623" : "rgba(80, 220, 160, 0.9)";
  for (const [a, b] of BONES) {
    if (lm[a][3] < 0.3 || lm[b][3] < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a][0] * W, lm[a][1] * H);
    ctx.lineTo(lm[b][0] * W, lm[b][1] * H);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  for (const i of [23, 24, 31, 32]) {
    if (lm[i][3] < 0.3) continue;
    ctx.beginPath();
    ctx.arc(lm[i][0] * W, lm[i][1] * H, ctx.lineWidth * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Hip and toe height around one jump, with fitted parabolas and events. */
export function drawJumpPlot(canvas: HTMLCanvasElement, s: Signals, j: Jump): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320, cssH = canvas.clientHeight || 160;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const t0 = j.tOff - 0.8, t1 = j.tOn + 0.5;
  const idx = s.t.map((t, i) => i).filter((i) => s.t[i] >= t0 && s.t[i] <= t1);
  const floor = j.debug.floor;
  const ys = idx.flatMap((i) => [s.hip[i] - floor, s.toe[i] - floor]).filter(Number.isFinite);
  if (ys.length === 0) return;
  const yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
  const pad = 8;
  const X = (t: number) => pad + ((t - t0) / (t1 - t0)) * (cssW - 2 * pad);
  const Y = (v: number) => cssH - pad - ((v - yMin) / (yMax - yMin || 1)) * (cssH - 2 * pad);

  ctx.strokeStyle = "#555";
  ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(cssW - pad, Y(0)); ctx.stroke();
  for (const [t, c] of [[j.tOff, "#4caf50"], [j.tApex, "#888"], [j.tOn, "#e53935"]] as const) {
    ctx.strokeStyle = c;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(t), pad); ctx.lineTo(X(t), cssH - pad); ctx.stroke();
  }
  ctx.setLineDash([]);

  const series = [
    { y: s.hip, fit: j.debug.hipFit, color: "#4a90d9" },
    { y: s.toe, fit: j.debug.toeFit, color: "#f5a623" },
  ];
  for (const { y, fit, color } of series) {
    ctx.fillStyle = color;
    for (const i of idx) if (Number.isFinite(y[i])) ctx.fillRect(X(s.t[i]) - 1.5, Y(y[i] - floor) - 1.5, 3, 3);
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const t = j.tOff - 0.03 + ((j.tOn - j.tOff + 0.06) * k) / 60;
      const v = evalQuadratic(fit, t) - floor;
      k ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v));
    }
    ctx.stroke();
  }
}
