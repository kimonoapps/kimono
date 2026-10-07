import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Field } from "@/components/field";
import { KimonoBranch } from "@/components/marks";
import { Problem } from "@/components/chrome";
import { Seal } from "@/components/seal";
import { useSession } from "@/lib/session";
import { color, font, size } from "@/theme";

export default function SignIn() {
  const { signIn, server } = useSession();
  const insets = useSafeAreaInsets();
  const [address, setAddress] = useState(server?.replace(/^https:\/\//, "") ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setProblem(null);
    try {
      await signIn(address);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Signing in didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.body}>
        <KimonoBranch size={76} />
        <Text style={styles.title}>Kimono</Text>
        <Text style={styles.lede}>Sign in with your Kimono account.</Text>
        <View style={styles.form}>
          <Field
            label="Your Kimono's address"
            value={address}
            onChangeText={setAddress}
            placeholder="kimono.example"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="go"
            onSubmitEditing={go}
          />
          <Problem>{problem}</Problem>
          <Seal label={busy ? "Opening sign-in…" : "Continue"} busy={busy} disabled={!address.trim()} onPress={go} />
        </View>
      </View>
      <Text style={styles.foot}>Only the people on your Kimono can sign in.</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  body: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 28, gap: 14 },
  title: { marginTop: 4, fontFamily: font.display, fontSize: 34, color: color.plum, letterSpacing: -0.6 },
  lede: { fontFamily: font.sans, fontSize: 15, color: color.inkSoft, textAlign: "center" },
  form: { alignSelf: "stretch", gap: size.space4, marginTop: size.space4 },
  foot: { paddingHorizontal: 28, textAlign: "center", fontFamily: font.sans, fontSize: 12.5, color: color.inkSoft },
});
