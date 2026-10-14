import { useState } from "react";
import { View } from "react-native";
import Svg, { G, Line, Polyline, Rect } from "react-native-svg";
import { evalQuadratic } from "../../../src/analysis/fit";
import type { Jump } from "../../../src/analysis/jumps";
import type { Signals } from "../../../src/analysis/types";
import { C } from "./theme";

/** Hip and toe height around one jump, with the fitted parabolas and takeoff · top · landing. */
export function JumpPlot({ signals: s, jump: j, height = 170 }: { signals: Signals; jump: Jump; height?: number }) {
  const [width, setWidth] = useState(0);
  const t0 = j.tOff - 0.8, t1 = j.tOn + 0.5;
  const idx = s.t.map((_, i) => i).filter((i) => s.t[i] >= t0 && s.t[i] <= t1);
  const floor = j.debug.floor;
  const ys = idx.flatMap((i) => [s.hip[i] - floor, s.toe[i] - floor]).filter(Number.isFinite);
  const yMin = Math.min(0, ...ys), yMax = Math.max(1, ...ys);
  const pad = 8;
  const X = (t: number) => pad + ((t - t0) / (t1 - t0)) * (width - 2 * pad);
  const Y = (v: number) => height - pad - ((v - yMin) / (yMax - yMin || 1)) * (height - 2 * pad);
  const series = [
    { y: s.hip, fit: j.debug.hipFit, color: C.hip },
    { y: s.toe, fit: j.debug.toeFit, color: C.toe },
  ];
  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && ys.length > 0 && (
        <Svg width={width} height={height}>
          <Line x1={pad} x2={width - pad} y1={Y(0)} y2={Y(0)} stroke="#555" />
          {([[j.tOff, "#4caf50"], [j.tApex, "#888"], [j.tOn, "#e53935"]] as const).map(([t, c]) => (
            <Line key={c} x1={X(t)} x2={X(t)} y1={pad} y2={height - pad} stroke={c} strokeDasharray="3,3" />
          ))}
          {series.map(({ y, fit, color }) => (
            <G key={color}>
              {idx.filter((i) => Number.isFinite(y[i])).map((i) => (
                <Rect key={i} x={X(s.t[i]) - 1.5} y={Y(y[i] - floor) - 1.5} width={3} height={3} fill={color} />
              ))}
              <Polyline
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                points={Array.from({ length: 61 }, (_, k) => {
                  const t = j.tOff - 0.03 + ((j.tOn - j.tOff + 0.06) * k) / 60;
                  return `${X(t)},${Y(evalQuadratic(fit, t) - floor)}`;
                }).join(" ")}
              />
            </G>
          ))}
        </Svg>
      )}
    </View>
  );
}
