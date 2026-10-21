/**
 * The local jump library (~/code/boing-data/library, never in git; format in docs/jump-library.md):
 * loading entries, their pose data and their truth on the pose's clock.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PoseFrame, PoseVideo } from "../../src/analysis/types";

export const LIBRARY = process.env.BOING_LIBRARY ?? join(homedir(), "code/boing-data/library");

export interface LibTruth {
  method: string;
  precision: string;
  takeoffT: number;
  landingT: number;
  flightMs: number;
  heightCm: number;
  clip?: string;
  takeoffFrame?: number;
  landingFrame?: number;
}

export interface LibJump {
  id: string;
  person: string;
  date: string | null;
  session: string;
  setup: Record<string, string | undefined>;
  devices?: Record<string, string>;
  clips: { role: string; file: string; captureFps?: number; frameOffset?: number; clipStart?: number }[];
  pose?: { role: string; file: string; clock: string }[];
  truth?: LibTruth;
  reference?: { method: string; valueCm: number; approxTakeoffT: number; flightMs?: number };
  clock?: { appMinusSide: number; precision: string };
  app?: Record<string, unknown>;
  tags: string[];
}

export interface Library {
  version: number;
  jumps: LibJump[];
  derived: { dir: string; truth: string }[];
}

/** The library, or null when it isn't on this machine. */
export function loadLibrary(dir = LIBRARY): Library | null {
  const p = join(dir, "jumps.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

export const libPath = (file: string, dir = LIBRARY) => join(dir, file);

/** A pose file of an entry (first one, or the given role), as a PoseVideo. */
export function poseOf(j: LibJump, role?: string, dir = LIBRARY): (PoseVideo & { model?: string }) | null {
  const p = (j.pose ?? []).find((x) => !role || x.role === role);
  if (!p) return null;
  const v = JSON.parse(readFileSync(libPath(p.file, dir), "utf8"));
  return { width: v.width, height: v.height, fps: v.fps, frames: v.frames as PoseFrame[], model: v.model };
}

/**
 * Truth takeoff/landing on the clock of the entry's front pose: the app's frame clock for native
 * re-measurements (2026-10-19 via the side clip's clock mapping), the video's real time otherwise.
 */
export function truthOnPoseClock(j: LibJump): { off: number; on: number; h: number } | null {
  const t = j.truth;
  if (!t) return null;
  const shift = t.clip === "side-240" ? (j.clock?.appMinusSide ?? NaN) : 0;
  return { off: t.takeoffT + shift, on: t.landingT + shift, h: t.heightCm / 100 };
}

/** Front-view frame rate class of an entry's pose (30 / 60 / full rate). */
export function rateOf(v: PoseVideo): number {
  const t = v.frames.map((f) => f.t);
  const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  return 1 / gaps[Math.floor(gaps.length / 2)];
}
