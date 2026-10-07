import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { color, font, size } from "@/theme";

/**
 * 判 Seal — Kata's hanko, as a native button. A carved block on a 2px base with
 * the inner ring cut 3px in; pressing it sinks the block onto its base. Quiet
 * is the block uninked, danger says the consequence on a rose wash.
 */
type Tone = "primary" | "quiet" | "danger";

const tones: Record<Tone, { face: string; base: string; text: string; ring: boolean }> = {
  primary: { face: color.suo, base: "#8a3e51", text: color.lift, ring: true },
  quiet: { face: color.fold, base: color.hairDeep, text: color.ink, ring: false },
  danger: { face: color.suoWash, base: "#ebc4cc", text: color.suoDeep, ring: false },
};

export function Seal({ label, tone = "primary", busy = false, compact = false, disabled, style, ...props }: PressableProps & {
  label: string;
  tone?: Tone;
  /** Says the work is happening; the seal can't be pressed again meanwhile. */
  busy?: boolean;
  compact?: boolean;
}) {
  const t = tones[tone];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy }}
      disabled={off}
      hitSlop={compact ? 4 : 0}
      style={(state) => [
        styles.seal,
        compact && styles.compact,
        { backgroundColor: off && !busy ? color.fold : t.face, borderBottomColor: off && !busy ? color.fold : t.base },
        state.pressed && styles.pressed,
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {({ pressed }) => <>
        {t.ring && !off ? <View style={[styles.ring, pressed && styles.ringPressed]} /> : null}
        {busy ? <ActivityIndicator size="small" color={t.text} style={styles.busy} /> : null}
        <Text style={[styles.label, { color: off && !busy ? color.faint : t.text }]} numberOfLines={1}>{label}</Text>
      </>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  seal: {
    minHeight: size.control,
    paddingHorizontal: size.space5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: size.rSeal,
    borderBottomWidth: 2,
  },
  compact: { minHeight: size.controlCompact, paddingHorizontal: size.space4 },
  pressed: { borderBottomWidth: 0, marginTop: 2, transform: [{ scale: 0.985 }] },
  ring: { pointerEvents: "none", position: "absolute", top: 3, left: 3, right: 3, bottom: 1, borderWidth: 1, borderColor: "rgba(255,253,248,0.32)", borderRadius: 1 },
  ringPressed: { top: 4, left: 4, right: 4, bottom: 4 },
  busy: { marginRight: size.space2 },
  label: { fontFamily: font.sansBold, fontSize: 13, letterSpacing: 0.52 },
});
