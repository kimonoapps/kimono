import { color, size } from "./tokens";

export { color, size };

/**
 * Kata's two faces, as loaded in the root layout: Shippori Mincho for display
 * text and names, Zen Kaku Gothic for everything read or pressed.
 */
export const font = {
  display: "ShipporiMincho_600SemiBold",
  sans: "ZenKakuGothicNew_400Regular",
  sansMedium: "ZenKakuGothicNew_500Medium",
  sansBold: "ZenKakuGothicNew_700Bold",
} as const;

/** The plum-tinted lift Kata gives sheets, as a native shadow. */
export const sheetShadow = { boxShadow: "0 8px 14px -6px rgba(78, 43, 55, 0.32)" } as const;
