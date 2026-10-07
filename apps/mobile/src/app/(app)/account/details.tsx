import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { parseProfileInput } from "@kimono/account";
import { Problem, ScreenHeader } from "@/components/chrome";
import { Field } from "@/components/field";
import { Seal } from "@/components/seal";
import { useSession } from "@/lib/session";
import { color, size } from "@/theme";

export default function Details() {
  const { me, api, refreshMe } = useSession();
  const [name, setName] = useState(me?.name ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* The email is where resets go, so changing it asks for the password. */
  const emailChanged = email.trim().toLowerCase() !== (me?.email ?? "").trim().toLowerCase();
  const changed = name.trim() !== (me?.name ?? "") || emailChanged;

  async function save() {
    setProblem(null);
    try {
      const change = parseProfileInput({ name, email });
      setBusy(true);
      await api("/api/v1/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...change, ...(emailChanged ? { currentPassword: current } : {}) }) });
      await refreshMe();
      router.back();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your account could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title="Name and email" end={<Seal compact label="Save" busy={busy} disabled={!changed || (emailChanged && !current)} onPress={save} />} />
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={80} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        {emailChanged ? <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" /> : null}
        <Field label="Username" value={me?.username ?? ""} editable={false} />
        <View><Problem>{problem}</Problem></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  form: { padding: size.space4, gap: size.space4 },
});
