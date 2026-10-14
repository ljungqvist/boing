import Svg, { Circle, Path, Rect } from "react-native-svg";
import { C } from "./theme";

export type IconName = "logo" | "menu" | "close" | "film" | "flip" | "soundOn" | "soundOff";

/** The web app's line icons. */
export function Icon({ name, size = 24, color = C.text }: { name: IconName; size?: number; color?: string }) {
  if (name === "logo") {
    return (
      <Svg width={size} height={size} viewBox="0 0 32 32">
        <Path d="M4 27 Q16 -7 28 27" fill="none" stroke={C.accent} strokeWidth={3.5} strokeLinecap="round" />
        <Circle cx={16} cy={10} r={4} fill={C.accent} />
      </Svg>
    );
  }
  const line = { fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "menu" && [5, 12, 19].map((y) => <Circle key={y} cx={12} cy={y} r={1.2} fill={color} />)}
      {name === "close" && <Path d="M6 6l12 12M18 6L6 18" {...line} />}
      {name === "film" && (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} {...line} />
          <Path d="M10 9.5v5l4.5-2.5z" fill={color} />
        </>
      )}
      {name === "flip" && (
        <>
          <Path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2" {...line} />
          <Path d="M20 4v4h-4M4 20v-4h4" {...line} />
        </>
      )}
      {(name === "soundOn" || name === "soundOff") && <Path d="M4 9v6h4l5 4V5L8 9z" {...line} />}
      {name === "soundOn" && <Path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" {...line} />}
      {name === "soundOff" && <Path d="M17 9l5 6M22 9l-5 6" {...line} />}
    </Svg>
  );
}
