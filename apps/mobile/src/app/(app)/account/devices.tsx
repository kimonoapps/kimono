import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { describeSession, type AccountSession } from "@kimono/account";
import { Problem, ScreenHeader } from "@/components/chrome";
import { Icon, type IconName } from "@/components/marks";
import { Seal } from "@/components/seal";
import { useSession } from "@/lib/session";
import { color, font, size } from "@/theme";

const iconFor = (session: AccountSession): IconName => /iphone|ipad|android|mobile/i.test(`${session.device} ${session.os}`) ? "phone" : /windows|linux/i.test(session.os) ? "desktop" : "laptop";

export default function Devices() {
  const { api, signOut } = useSession();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const fetchSessions = useCallback(() => api<{ sessions: AccountSession[] }>("/api/v1/me/sessions").then(
    (body) => { setSessions(body.sessions); setProblem(null); },
    (error: unknown) => { setProblem(error instanceof Error ? error.message : "Your sign-ins could not be listed."); },
  ), [api]);

  useEffect(() => {
    let live = true;
    api<{ sessions: AccountSession[] }>("/api/v1/me/sessions").then(
      (body) => { if (live) setSessions(body.sessions); },
      (error: unknown) => { if (live) setProblem(error instanceof Error ? error.message : "Your sign-ins could not be listed."); },
    );
    return () => { live = false; };
  }, [api]);

  async function pullToRefresh() {
    setLoading(true);
    await fetchSessions();
    setLoading(false);
  }

  async function end(id: string) {
    setEnding(id);
    try {
      await api(`/api/v1/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSessions((list) => list?.filter((item) => item.id !== id) ?? null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That sign-in could not be ended.");
    } finally {
      setEnding(null);
    }
  }

  async function endEverywhere() {
    setEnding("all");
    try {
      await api("/api/v1/me/sessions", { method: "DELETE" });
      /* Everywhere includes this phone. */
      await signOut();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Those sign-ins could not be ended.");
      setEnding(null);
    }
  }

  return (
    <View style={styles.page}>
      <ScreenHeader title="Signed-in devices" />
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={loading && sessions !== null} onRefresh={pullToRefresh} tintColor={color.suo} />}>
        <Problem>{problem}</Problem>
        {sessions === null && !problem ? <ActivityIndicator color={color.suo} style={styles.wait} /> : null}
        {sessions?.length === 0 ? <Text style={styles.note}>No browser is signed in right now.</Text> : null}
        {sessions?.map((item) => {
          const text = describeSession(item);
          return (
            <View key={item.id} style={styles.device}>
              <View style={styles.icon}><Icon name={iconFor(item)} /></View>
              <View style={styles.copy}>
                <Text style={styles.title}>{text.title}</Text>
                {text.detail ? <Text style={styles.detail}>{text.detail}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Sign out ${text.title}`} disabled={ending !== null} onPress={() => end(item.id)} hitSlop={8} style={styles.end}>
                {ending === item.id ? <ActivityIndicator size="small" color={color.suo} /> : <Icon name="close" size={18} tint={color.inkSoft} />}
              </Pressable>
            </View>
          );
        })}
        <View style={styles.everywhere}>
          {confirming ? <>
            <Text style={styles.note}>This signs out every browser and this phone. You’ll sign in again here.</Text>
            <View style={styles.pair}>
              <Seal tone="quiet" label="Keep them" onPress={() => setConfirming(false)} style={styles.half} />
              <Seal tone="danger" label="Sign out all" busy={ending === "all"} onPress={endEverywhere} style={styles.half} />
            </View>
          </> : <Seal tone="danger" label="Sign out everywhere" disabled={ending !== null} onPress={() => setConfirming(true)} />}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  body: { padding: size.space4, paddingTop: size.space2 },
  wait: { marginTop: 32 },
  note: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.inkSoft },
  device: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 14, borderBottomWidth: 1, borderBottomColor: color.hair },
  icon: { width: 40, height: 40, borderRadius: 2, backgroundColor: color.fold, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, paddingVertical: 10 },
  title: { fontFamily: font.sansBold, fontSize: 14, color: color.ink },
  detail: { marginTop: 2, fontFamily: font.sans, fontSize: 12.5, color: color.inkSoft },
  end: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  everywhere: { marginTop: 22, gap: 12 },
  pair: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
