import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { passwordMinLength, passwordRules } from "@kimono/account";
import { Problem, ScreenHeader } from "@/components/chrome";
import { Field } from "@/components/field";
import { Icon } from "@/components/marks";
import { Seal } from "@/components/seal";
import { useSession } from "@/lib/session";
import { color, font, size } from "@/theme";

export default function Password() {
  const { me, api, signOut } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rules = passwordRules(next, { username: me?.username ?? "", name: me?.name });
  const ready = Boolean(current) && rules.long && rules.notName && next === again;

  async function save() {
    setProblem(null);
    setBusy(true);
    try {
      await api("/api/v1/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next, confirm: again, signOutOthers }) });
      /* Signing out everywhere includes this phone; it signs in again with the new password. */
      if (signOutOthers) await signOut();
      else router.back();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title="Password" end={<Seal compact label="Change" busy={busy} disabled={!ready} onPress={save} />} />
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
        <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <View style={styles.rules}>
          <Rule met={rules.long}>{`At least ${passwordMinLength} characters`}</Rule>
          <Rule met={rules.notName}>Not your name or username</Rule>
        </View>
        <Field label="Type it again" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        {again && next !== again ? <Problem>The two new passwords don’t match.</Problem> : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: signOutOthers }} onPress={() => setSignOutOthers(!signOutOthers)} style={styles.check}>
          <View style={[styles.box, signOutOthers && styles.boxOn]}>{signOutOthers ? <Icon name="check" size={14} tint={color.lift} weight={2.6} /> : null}</View>
          <Text style={styles.checkLabel}>Sign out everywhere, this phone too</Text>
        </Pressable>
        <Problem>{problem}</Problem>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* A rule changes form when met: an empty ring fills with moss and gains a tick. */
function Rule({ met, children }: { met: boolean; children: string }) {
  return (
    <View style={styles.rule} accessibilityLabel={`${children}${met ? ", done" : ""}`}>
      <View style={[styles.dot, met && styles.dotMet]}>{met ? <Icon name="check" size={11} tint={color.lift} weight={2.8} /> : null}</View>
      <Text style={[styles.ruleText, met && styles.ruleMet]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  form: { padding: size.space4, gap: size.space4 },
  rules: { gap: size.space2, marginTop: -4 },
  rule: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: color.hairDeep, alignItems: "center", justifyContent: "center" },
  dotMet: { borderColor: color.moss, backgroundColor: color.moss },
  ruleText: { fontFamily: font.sans, fontSize: 13.5, color: color.inkSoft },
  ruleMet: { color: color.ink },
  check: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 2, borderWidth: 1.5, borderColor: color.hairDeep, backgroundColor: color.lift, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: color.suo, borderColor: color.suo },
  checkLabel: { flex: 1, fontFamily: font.sans, fontSize: 14, color: color.ink },
});
