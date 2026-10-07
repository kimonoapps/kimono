import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Takes or picks a photo, lets the person square it up, and returns it as the
 * 512×512 PNG the Portal stores. The Portal re-checks and strips it anyway;
 * this only makes the upload the right size to begin with.
 */
export async function pickPicture(from: "camera" | "library"): Promise<Uint8Array | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 };
  if (from === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("Kimono can't use the camera. Allow it in Settings, or choose a photo instead.");
  }
  const result = from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const { uri, width, height } = result.assets[0];
  /* The editor squares it on the phone; anything that arrives unsquared is cut from the middle. */
  const side = Math.min(width, height);
  const context = ImageManipulator.manipulate(uri);
  if (width !== height && side > 0) context.crop({ originX: (width - side) / 2, originY: (height - side) / 2, width: side, height: side });
  context.resize({ width: 512, height: 512 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error("That photo couldn't be read. Try another.");
  const binary = atob(saved.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
