import sharp from "sharp";
import { bloomSvg } from "@kimono/ui/bloom-svg";
import { getPlatformSettings } from "@/lib/settings";
import { watchIdentity } from "@/lib/watch/config";

/*
 * Watch's own favicon: its bloom with the play glyph, in Watch's colours as
 * set now. `icon.svg` for browsers that take one; 16, 32 and 48 px PNGs for
 * the rest; 180 px on night for the home screen, where iOS fills a clear
 * background with black.
 */
const sizes: Record<string, number> = { "16.png": 16, "32.png": 32, "48.png": 48, "180.png": 180 };

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (file !== "icon.svg" && !sizes[file]) return new Response("No such icon.", { status: 404 });
  const app = await watchIdentity(await getPlatformSettings());
  const svg = bloomSvg({ id: app.id, accent: app.accent }, { glyph: "play", standalone: true, unique: "watch" });
  const cache = { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" };
  if (file === "icon.svg") return new Response(svg, { headers: { "content-type": "image/svg+xml", ...cache } });
  const size = sizes[file];
  const flower = sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil((size / 100) * 72 * 4)) }).resize(size === 180 ? 144 : size, size === 180 ? 144 : size);
  const png = size === 180
    ? await sharp({ create: { width: 180, height: 180, channels: 4, background: "#2a1d22" } }).composite([{ input: await flower.png().toBuffer(), gravity: "center" }]).png().toBuffer()
    : await flower.png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", ...cache } });
}
