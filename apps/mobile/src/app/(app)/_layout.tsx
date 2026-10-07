import { Stack } from "expo-router";
import { color } from "@/theme";

export default function SignedIn() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }} />;
}
