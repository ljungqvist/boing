import { describe, expect, it } from "vitest";
import { evalQuadratic, fitQuadratic, quadraticRoots } from "./fit";

const range = (n: number, dt: number, t0 = 0) => Array.from({ length: n }, (_, i) => t0 + i * dt);

describe("fitQuadratic", () => {
  it("recovers an exact parabola, even far from t = 0", () => {
    const t = range(15, 1 / 30, 100);
    const y = t.map((x) => -4.9 * x * x + 3 * x + 2);
    const q = fitQuadratic(t, y);
    expect(q.a).toBeCloseTo(-4.9, 6);
    for (const x of t) expect(evalQuadratic(q, x)).toBeCloseTo(-4.9 * x * x + 3 * x + 2, 4);
    expect(q.rms).toBeLessThan(1e-6);
  });

  it("averages out noise", () => {
    const t = range(60, 1 / 120);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    const y = t.map((x) => -4.9 * x * x + 2.4 * x + rand());
    const q = fitQuadratic(t, y);
    expect(q.a).toBeCloseTo(-4.9, 0);
    expect(q.rms).toBeGreaterThan(0.001);
    expect(q.rms).toBeLessThan(0.005);
  });

  it("rejects too few points", () => {
    expect(() => fitQuadratic([0, 1], [0, 1])).toThrow();
  });
});

describe("quadraticRoots", () => {
  it("finds both crossings of a level, sorted", () => {
    const q = fitQuadratic([0, 1, 2], [0, 1, 0]); // y = -t^2 + 2t
    const r = quadraticRoots(q, 0.75)!;
    expect(r[0]).toBeCloseTo(0.5, 9);
    expect(r[1]).toBeCloseTo(1.5, 9);
  });

  it("returns null when the level is never reached", () => {
    const q = fitQuadratic([0, 1, 2], [0, 1, 0]);
    expect(quadraticRoots(q, 2)).toBeNull();
  });

  it("gives the vertex time", () => {
    const q = fitQuadratic([0, 1, 2], [0, 1, 0]);
    expect(q.vertex).toBeCloseTo(1, 9);
  });
});
