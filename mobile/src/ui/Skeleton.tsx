import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import type { Landmark } from "../../../src/analysis/types";
import type { Size } from "../logic/pose";
import { C } from "./theme";

const BONES: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export interface PoseView {
  lm: Landmark[] | null;
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

/** The detected body over the preview (letterboxed like the preview: resizeMode "contain"). */
export function Skeleton({ feed }: { feed: PoseFeed }) {
  const [pose, setPose] = useState<PoseView | null>(null);
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => feed.subscribe(setPose), [feed]);
  const lm = pose?.lm;
  let content = null;
  if (lm && pose.size.width > 0 && view.width > 0) {
    const k = Math.min(view.width / pose.size.width, view.height / pose.size.height);
    const w = pose.size.width * k, h = pose.size.height * k;
    const ox = (view.width - w) / 2, oy = (view.height - h) / 2;
    const X = (i: number) => ox + lm[i][0] * w;
    const Y = (i: number) => oy + lm[i][1] * h;
    const color = pose.air ? C.toe : "rgba(80, 220, 160, 0.9)";
    content = (
      <Svg width={view.width} height={view.height}>
        {BONES.filter(([a, b]) => lm[a][3] >= 0.3 && lm[b][3] >= 0.3).map(([a, b]) => (
          <Line key={`${a}-${b}`} x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke={color} strokeWidth={3} />
        ))}
        {[23, 24, 31, 32].filter((i) => lm[i][3] >= 0.3).map((i) => (
          <Circle key={i} cx={X(i)} cy={Y(i)} r={5} fill="#fff" />
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
