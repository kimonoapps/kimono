import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenHeader } from "@/components/chrome";
import { KimonoBranch } from "@/components/marks";
import { useSession } from "@/lib/session";
import { color, font } from "@/theme";

/* The home screen's layout is still being chosen (design/mockups/mobile.html);
   until then it greets, as the website's home does. */
export default function Home() {
  const { me } = useSession();
  const first = me?.name?.split(" ")[0] || me?.username || "home";
  return (
    <View style={styles.page}>
      <ScreenHeader back={false} title={<View style={styles.mark}><KimonoBranch size={30} /><Text style={styles.word}>kimono</Text></View>} />
      <ScrollView contentContainerStyle={styles.hello}>
        <Text style={styles.kicker}>Your household</Text>
        <Text style={styles.heading}>Welcome home, <Text style={styles.name}>{first}.</Text></Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  mark: { flexDirection: "row", alignItems: "center", gap: 8 },
  word: { fontFamily: font.display, fontSize: 22, color: color.plum, letterSpacing: -0.2 },
  hello: { paddingHorizontal: 20, paddingTop: 22 },
  kicker: { marginBottom: 6, fontFamily: font.sansBold, fontSize: 12, color: color.suoDeep },
  heading: { fontFamily: font.display, fontSize: 34, lineHeight: 37, letterSpacing: -0.7, color: color.plum },
  name: { color: color.suo },
});
