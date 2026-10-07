import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { initialOf } from "@kimono/account";
import { color, font } from "@/theme";

/** A person's picture, or the first letter of their name when they have none, as on the website. */
export function Portrait({ picture, name, username, size }: { picture: string | null | undefined; name?: string | null; username?: string | null; size: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (picture) return <Image source={{ uri: picture }} style={[styles.ring, round]} contentFit="cover" transition={150} accessibilityLabel={name || username || undefined} />;
  return (
    <View style={[styles.initial, round]} accessibilityLabel={name || username || undefined}>
      <Text style={[styles.letter, { fontSize: size * 0.46 }]} allowFontScaling={false}>{initialOf(name, username)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { backgroundColor: color.fold, borderWidth: 1, borderColor: color.hair },
  initial: { alignItems: "center", justifyContent: "center", backgroundColor: color.fold, borderWidth: 1, borderColor: color.hairDeep },
  letter: { fontFamily: font.display, color: color.plum },
});
