import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { GroupLabel, List, ListRow, Problem, ScreenHeader } from "@/components/chrome";
import { Icon } from "@/components/marks";
import { Portrait } from "@/components/portrait";
import { Sheet, SheetItem } from "@/components/sheet";
import { pickPicture } from "@/lib/picture";
import { useSession } from "@/lib/session";
import { color, font, sheetShadow } from "@/theme";

export default function You() {
  const { me, api, refreshMe, signOut } = useSession();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function change(from: "camera" | "library") {
    setChoosing(false);
    setProblem(null);
    try {
      const png = await pickPicture(from);
      if (!png) return;
      setBusy(true);
      await api("/api/v1/me/picture", { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
      await refreshMe();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your picture could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setChoosing(false);
    setProblem(null);
    try {
      setBusy(true);
      await api("/api/v1/me/picture", { method: "DELETE" });
      await refreshMe();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your picture could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.page}>
      <ScreenHeader back={false} title="You" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View>
            <Portrait picture={me?.picture} name={me?.name} username={me?.username} size={96} />
            <Pressable accessibilityRole="button" accessibilityLabel="Change picture" disabled={busy} onPress={() => setChoosing(true)} style={({ pressed }) => [styles.camera, pressed && styles.cameraPressed]}>
              <Icon name="camera" size={17} />
            </Pressable>
          </View>
          <Text style={styles.name}>{me?.name}</Text>
          <Text style={styles.who}>@{me?.username}{me?.email ? ` · ${me.email}` : ""}</Text>
          {busy ? <Text style={styles.who}>Saving your picture…</Text> : null}
          <Problem>{problem}</Problem>
        </View>
        <GroupLabel>Account</GroupLabel>
        <List>
          <ListRow label="Name and email" onPress={() => router.push("/account/details")} />
          <ListRow label="Password" onPress={() => router.push("/account/password")} />
          <ListRow label="Signed-in devices" onPress={() => router.push("/account/devices")} />
        </List>
        <GroupLabel>This phone</GroupLabel>
        <List>
          <ListRow label="Sign out" tone="danger" onPress={signOut} />
        </List>
      </ScrollView>
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="Your picture">
        <SheetItem label="Take a photo" onPress={() => change("camera")} />
        <SheetItem label="Choose a photo" onPress={() => change("library")} />
        {me?.picture ? <SheetItem label="Remove picture" tone="danger" onPress={remove} /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  scroll: { paddingBottom: 32 },
  hero: { alignItems: "center", gap: 8, paddingTop: 22, paddingBottom: 18, paddingHorizontal: 16 },
  camera: { position: "absolute", right: -4, bottom: -2, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.lift, borderWidth: 1, borderColor: color.hairDeep, ...sheetShadow },
  cameraPressed: { backgroundColor: color.fold },
  name: { marginTop: 6, fontFamily: font.display, fontSize: 24, color: color.plum, textAlign: "center" },
  who: { fontFamily: font.sans, fontSize: 13, color: color.inkSoft, textAlign: "center" },
});
