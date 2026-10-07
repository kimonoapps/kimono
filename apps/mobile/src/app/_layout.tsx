import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { SessionProvider, useSession } from "@/lib/session";
import { color } from "@/theme";

export default function RootLayout() {
  /* Latin cuts of Kata's faces (scripts/fonts.py); the full Japanese sets are 9 MB a weight. */
  const [fontsReady] = useFonts({
    ShipporiMincho_600SemiBold: require("../../assets/fonts/ShipporiMincho_600SemiBold.ttf"),
    ZenKakuGothicNew_400Regular: require("../../assets/fonts/ZenKakuGothicNew_400Regular.ttf"),
    ZenKakuGothicNew_500Medium: require("../../assets/fonts/ZenKakuGothicNew_500Medium.ttf"),
    ZenKakuGothicNew_700Bold: require("../../assets/fonts/ZenKakuGothicNew_700Bold.ttf"),
  });
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        {fontsReady ? <Routes /> : <View style={{ flex: 1, backgroundColor: color.ground }} />}
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/* Signed in, the app; signed out, the sign-in screen. Nothing is shown until
   a kept sign-in has been checked, so a revoked one never flashes as yours. */
function Routes() {
  const { status } = useSession();
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: color.ground }} />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
      <Stack.Protected guard={status === "signed-in"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signed-out"}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="auth" />
    </Stack>
  );
}
