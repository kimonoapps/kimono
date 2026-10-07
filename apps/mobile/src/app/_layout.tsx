import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { ShipporiMincho_600SemiBold } from "@expo-google-fonts/shippori-mincho";
import { ZenKakuGothicNew_400Regular, ZenKakuGothicNew_500Medium, ZenKakuGothicNew_700Bold } from "@expo-google-fonts/zen-kaku-gothic-new";
import { SessionProvider, useSession } from "@/lib/session";
import { color } from "@/theme";

export default function RootLayout() {
  const [fontsReady] = useFonts({ ShipporiMincho_600SemiBold, ZenKakuGothicNew_400Regular, ZenKakuGothicNew_500Medium, ZenKakuGothicNew_700Bold });
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
