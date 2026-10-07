/**
 * 肖 A profile picture, as Kimono keeps it.
 *
 * The browser crops and re-draws the photo onto a canvas before uploading, so
 * what arrives is a fresh 512×512 PNG. This is the server's half of that
 * promise: it accepts only that shape, and rebuilds the file from the chunks
 * that draw pixels, so no text, timestamp or location metadata a client might
 * attach can survive into a picture everyone on Kimono can see.
 */

export const pictureSize = 512;
export const pictureMaxBytes = 2 * 1024 * 1024;

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
/* Everything needed to draw the image, and nothing that describes it. */
const kept = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

export function sanitizePicturePng(input: Uint8Array): Uint8Array {
  if (input.byteLength > pictureMaxBytes) throw new Error("That picture is larger than 2 MB.");
  if (input.byteLength < signature.length || signature.some((byte, index) => input[index] !== byte)) {
    throw new Error("Upload the cropped picture as a PNG.");
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const parts: Uint8Array[] = [input.subarray(0, signature.length)];
  let offset = signature.length;
  let index = 0;
  let ended = false;
  while (offset < input.byteLength) {
    if (offset + 12 > input.byteLength) throw new Error("That picture is damaged.");
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > input.byteLength) throw new Error("That picture is damaged.");
    if (index === 0) {
      if (type !== "IHDR" || length !== 13) throw new Error("That picture is damaged.");
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (width !== pictureSize || height !== pictureSize) throw new Error(`Pictures are stored at ${pictureSize}×${pictureSize}.`);
    }
    if (kept.has(type)) parts.push(input.subarray(offset, end));
    offset = end;
    index += 1;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended) throw new Error("That picture is damaged.");
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let cursor = 0;
  for (const part of parts) { output.set(part, cursor); cursor += part.byteLength; }
  return output;
}
