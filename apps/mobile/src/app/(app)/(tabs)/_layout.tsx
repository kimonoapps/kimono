import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/marks";
import { Portrait } from "@/components/portrait";
import { useSession } from "@/lib/session";
import { color, font } from "@/theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.ground } }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}

/* The website's footer rail as a tab bar: the tab you're on is marked by a
   bar in suō along its top edge. Your own picture is the You tab. */
function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const title = descriptors[route.key].options.title ?? route.name;
        const tint = focused ? color.plum : color.inkSoft;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => { if (!focused) navigation.navigate(route.name); }}
            style={styles.tab}
          >
            {focused ? <View style={styles.marker} /> : null}
            {route.name === "you" ? <Portrait picture={me?.picture} name={me?.name} username={me?.username} size={24} /> : <Icon name="home" tint={tint} />}
            <Text style={[styles.label, { color: tint }]}>{title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: color.ground, borderTopWidth: 1, borderTopColor: color.hair },
  tab: { flex: 1, alignItems: "center", gap: 3, paddingTop: 8 },
  marker: { position: "absolute", top: -1, width: "36%", height: 3, backgroundColor: color.suo },
  label: { fontFamily: font.sansBold, fontSize: 11 },
});
