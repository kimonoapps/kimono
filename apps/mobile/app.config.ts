import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json, plus one switch. A real build talks to a Kimono over HTTPS only;
 * KIMONO_LOCAL_TEST=1 lets a test build reach a Portal running on this machine
 * over plain http, the way the emulator does. Never ship one of those.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Kimono",
  slug: config.slug ?? "kimono",
  plugins: [
    ...(config.plugins ?? []),
    ["expo-build-properties", { android: { usesCleartextTraffic: process.env.KIMONO_LOCAL_TEST === "1" } }],
  ],
});
