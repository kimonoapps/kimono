import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Where the app keeps what it needs between launches: the Keychain on iPhone,
 * the Keystore on Android. The browser build (used only while developing) has
 * neither, so it uses localStorage.
 */
const web = Platform.OS === "web";

export async function readKept(key: string): Promise<string | null> {
  if (web) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

export async function keep(key: string, value: string | null) {
  if (web) {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch { /* a browser that refuses storage just forgets */ }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}
