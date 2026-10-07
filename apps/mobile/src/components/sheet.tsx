import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, size } from "@/theme";

/** A sheet raised from the bottom over a dimmed screen. Tapping outside closes it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + size.space3 }]}>
        <View style={styles.grab} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {children}
      </View>
    </Modal>
  );
}

/** One choice in a sheet. */
export function SheetItem({ label, onPress, tone }: { label: string; onPress: () => void; tone?: "danger" }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <Text style={[styles.itemLabel, tone === "danger" && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(42,29,34,0.32)" },
  sheet: { backgroundColor: color.lift, borderTopWidth: 1, borderTopColor: color.hair, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  grab: { alignSelf: "center", width: 40, height: 4, marginTop: 8, marginBottom: 4, borderRadius: 2, backgroundColor: color.hairDeep },
  title: { paddingHorizontal: size.space4, paddingTop: 10, paddingBottom: 6, fontFamily: font.display, fontSize: 21, color: color.plum },
  item: { minHeight: 52, justifyContent: "center", paddingHorizontal: size.space4, borderTopWidth: 1, borderTopColor: color.hair },
  pressed: { backgroundColor: color.hover },
  itemLabel: { fontFamily: font.sans, fontSize: 16, color: color.ink },
  danger: { fontFamily: font.sansBold, color: color.suoDeep },
});
