import type { AppIdentity } from "@kimono/ui";
import sharp from "sharp";
import { appFaviconSvg, faviconApps, type FaviconApp, type FaviconSize } from "@/lib/app-favicon";
import { appIdentity, appRegistry } from "@/lib/apps";
import { booksIdentity } from "@/lib/books/config";
import { codeIdentity } from "@/lib/code/config";
import { getAppDefinition } from "@/lib/definitions";
import { driveIdentity } from "@/lib/drive/config";
import { identityOf, ownApp } from "@/lib/kimono-apps";
import { notesIdentity } from "@/lib/notes/config";
import { getPlatformSettings, type PlatformSettings } from "@/lib/settings";
import { watchIdentity } from "@/lib/watch/config";

/*
 * Each app's tab icon (lib/app-favicon.ts), in its colours as set now:
 * `icon.svg` for browsers that take one; 16, 32 and 48 px PNGs for the rest;
 * 180 px for the home screen.
 */
const sizes: Record<string, [number, FaviconSize]> = { "16.png": [16, "tiny"], "32.png": [32, "small"], "48.png": [48, "small"], "180.png": [180, "large"] };

const identities: Record<FaviconApp, (settings: PlatformSettings) => Promise<AppIdentity | undefined>> = {
  drive: driveIdentity,
  notes: notesIdentity,
  books: booksIdentity,
  ai: codeIdentity,
  watch: watchIdentity,
  vpn: async () => identityOf(ownApp("kimono-vpn")),
  tools: async (settings) => {
    const definition = await getAppDefinition("kimono-tools");
    const app = definition && appRegistry(settings, [definition]).find((item) => item.id === "kimono-tools");
    return app ? appIdentity(app) : undefined;
  },
};

export async function GET(_request: Request, { params }: { params: Promise<{ app: string; file: string }> }) {
  const { app: name, file } = await params;
  if (!faviconApps.includes(name as FaviconApp) || (file !== "icon.svg" && !sizes[file])) return new Response("No such icon.", { status: 404 });
  const app = await identities[name as FaviconApp](await getPlatformSettings());
  if (!app) return new Response("No such icon.", { status: 404 });
  const cache = { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" };
  if (file === "icon.svg") return new Response(appFaviconSvg(app, "small"), { headers: { "content-type": "image/svg+xml", ...cache } });
  const [size, drawing] = sizes[file];
  const png = await sharp(Buffer.from(appFaviconSvg(app, drawing)), { density: Math.ceil((size / 100) * 72 * 4) }).resize(size, size).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", ...cache } });
}
