import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { C } from "./theme";

const BONES: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** A landmark in preview-view coordinates, with its visibility. */
export interface ViewPoint {
  x: number;
  y: number;
  v: number;
}

export interface PoseView {
  /** 33 landmarks in preview coordinates, or null (nobody found, or the preview isn't ready). */
  points: ViewPoint[] | null;
  air: boolean;
}

/** A tiny event source, so only the skeleton re-renders on every analysed frame. */
export class PoseFeed {
  private listeners = new Set<(p: PoseView) => void>();
  emit(p: PoseView) {
    this.listeners.forEach((l) => l(p));
  }
  subscribe(l: (p: PoseView) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
}

/** The detected body over the camera preview (points already converted to preview coordinates). */
export function Skeleton({ feed }: { feed: PoseFeed }) {
  const [pose, setPose] = useState<PoseView | null>(null);
  useEffect(() => feed.subscribe(setPose), [feed]);
  const pts = pose?.points;
  if (!pts) return null;
  const color = pose.air ? C.toe : "rgba(80, 220, 160, 0.9)";
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {BONES.filter(([a, b]) => pts[a].v >= 0.3 && pts[b].v >= 0.3).map(([a, b]) => (
        <Line key={`${a}-${b}`} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke={color} strokeWidth={3} />
      ))}
      {[23, 24, 31, 32].filter((i) => pts[i].v >= 0.3).map((i) => (
        <Circle key={i} cx={pts[i].x} cy={pts[i].y} r={5} fill="#fff" />
      ))}
    </Svg>
  );
}
