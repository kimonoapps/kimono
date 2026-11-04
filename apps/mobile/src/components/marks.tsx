import Svg, { Circle, G, Path } from "react-native-svg";
import { color } from "@/theme";

const petal = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z";

/** Kimono's ink branch, the same drawing as the website's KimonoBranch. */
export function KimonoBranch({ size = 30, tint = color.plum }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size * 106 / 111} viewBox="1 12 111 106" fill={tint}>
      <Path d="M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z" />
      <Path d="M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z" />
      <Path d="M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z" />
      <G transform="translate(83 41) scale(.55) translate(-50 -50)">
        {[0, 72, 144, 216, 288].map((r) => <Path key={r} d={petal} transform={`rotate(${r} 50 50)`} />)}
        <Circle cx={50} cy={50} r={13} />
      </G>
    </Svg>
  );
}

/* 24px line icons, round joins, as drawn in the mockups. */
const icons = {
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5 M10 20v-5h4v5",
  back: "M19 12H5M11 6l-6 6 6 6",
  close: "M6 6l12 12M18 6 6 18",
  camera: "M4 8h3.5L9 5.5h6L16.5 8H20v11H4z M15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  go: "m9 6 6 6-6 6",
  phone: "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z M10.5 18.5h3",
  laptop: "M5 5.5h14v10H5z M3 18.5h18",
  desktop: "M3.5 4.5h17v11h-17z M9 20h6 M12 15.5V20",
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 22, tint = color.ink, weight = 1.7 }: { name: IconName; size?: number; tint?: string; weight?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
      <Path d={icons[name]} />
    </Svg>
  );
}
