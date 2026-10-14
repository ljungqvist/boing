import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Landmark } from "../../../src/analysis/types";
import { frameToView } from "../logic/overlay";
import type { Size } from "../logic/pose";
import Svg, { Circle, Line } from "react-native-svg";
import { C } from "./theme";

const BONES: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export interface PoseView {
  /** 33 landmarks of the analysed frame (normalised), or null when nobody was found. */
  lm: Landmark[] | null;
  /** Upright frame size in pixels. */
  size: Size;
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

/** The detected body over the camera preview (see `frameToView` for the geometry). */
export function Skeleton({ feed, mirrored }: { feed: PoseFeed; mirrored: boolean }) {
  const [pose, setPose] = useState<PoseView | null>(null);
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => feed.subscribe(setPose), [feed]);
  const lm = pose?.lm;
  let content = null;
  if (lm && pose.size.width > 0 && view.width > 0) {
    const pts = lm.map((l) => frameToView(l[0], l[1], pose.size, view, mirrored));
    const ok = (i: number) => lm[i][3] >= 0.3;
    const color = pose.air ? C.toe : "rgba(80, 220, 160, 0.9)";
    content = (
      <Svg width={view.width} height={view.height}>
        {BONES.filter(([a, b]) => ok(a) && ok(b)).map(([a, b]) => (
          <Line key={`${a}-${b}`} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke={color} strokeWidth={3} />
        ))}
        {[23, 24, 31, 32].filter(ok).map((i) => (
          <Circle key={i} cx={pts[i].x} cy={pts[i].y} r={5} fill="#fff" />
        ))}
      </Svg>
    );
  }
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {content}
    </View>
  );
}
