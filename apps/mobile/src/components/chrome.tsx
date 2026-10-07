import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, size } from "@/theme";
import { Icon } from "./marks";

/**
 * The bar across the top of every screen: ground paper ruled off in plum, the
 * way the website's header is. Actions sit at its right edge.
 */
export function ScreenHeader({ title, back = true, end }: { title?: ReactNode; back?: boolean; end?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.head, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={() => router.back()} style={styles.back}>
            <Icon name="back" tint={color.inkSoft} />
          </Pressable>
        ) : null}
        {typeof title === "string" ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : title}
        <View style={styles.end}>{end}</View>
      </View>
    </View>
  );
}

/** A small group heading over a list. */
export function GroupLabel({ children }: { children: string }) {
  return <Text style={styles.group}>{children}</Text>;
}

/** One line of a settings list: what it is, its state, and where it goes. */
export function ListRow({ label, detail, onPress, tone }: { label: string; detail?: string; onPress: () => void; tone?: "danger" }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Text style={[styles.rowLabel, tone === "danger" && styles.danger]}>{label}</Text>
      {detail ? <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      {tone ? null : <Icon name="go" size={16} tint={color.faint} weight={2} />}
    </Pressable>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <View style={styles.list}>{children}</View>;
}

/** A sentence that says something went wrong, in suō. */
export function Problem({ children }: { children: string | null }) {
  if (!children) return null;
  return <Text accessibilityRole="alert" style={styles.problem}>{children}</Text>;
}

const styles = StyleSheet.create({
  head: { backgroundColor: color.ground, borderBottomWidth: 2, borderBottomColor: color.plum },
  bar: { height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: size.space4, paddingRight: size.space3 },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: -6 },
  title: { flexShrink: 1, fontFamily: font.sansBold, fontSize: 16, color: color.ink },
  end: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: size.space2 },
  group: { paddingTop: 18, paddingHorizontal: size.space4, paddingBottom: size.space2, fontFamily: font.sansBold, fontSize: 12, color: color.inkSoft },
  list: { backgroundColor: color.sheet, borderTopWidth: 1, borderTopColor: color.hair },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: size.space4, borderBottomWidth: 1, borderBottomColor: color.hair },
  rowPressed: { backgroundColor: color.hover },
  rowLabel: { flex: 1, fontFamily: font.sans, fontSize: 15, color: color.ink },
  rowDetail: { maxWidth: "45%", fontFamily: font.sans, fontSize: 13, color: color.inkSoft },
  danger: { fontFamily: font.sansBold, color: color.suoDeep },
  problem: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.suoDeep },
});
