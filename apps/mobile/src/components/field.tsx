import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { color, font, size } from "@/theme";

/** A labelled input, Kata's .k-field: fold paper at rest, lifted and ringed in suō while typing. */
export const Field = forwardRef<TextInput, TextInputProps & { label: string; hint?: string }>(function Field({ label, hint, style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={color.faint}
        selectionColor={color.suo}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        style={[styles.input, focused && styles.focused, props.editable === false && styles.fixed, style]}
        {...props}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: size.space2 },
  label: { fontFamily: font.sansBold, fontSize: 12, letterSpacing: 0.12, color: color.inkSoft },
  input: {
    minHeight: size.control,
    paddingHorizontal: size.space4,
    borderWidth: size.hairline,
    borderColor: color.hair,
    borderRadius: size.r2,
    backgroundColor: color.fold,
    color: color.ink,
    fontFamily: font.sans,
    fontSize: 16,
  },
  focused: { borderColor: color.suo, backgroundColor: color.lift, boxShadow: "0 0 0 3px rgba(168, 77, 99, 0.22)", outlineStyle: "solid", outlineWidth: 0 },
  fixed: { backgroundColor: "transparent", borderStyle: "dashed", color: color.faint },
  hint: { fontFamily: font.sans, fontSize: 13, lineHeight: 19, color: color.inkSoft },
});
