import { readPictureFile } from "@/lib/pictures";

/**
 * A profile picture by its random file name. Public on purpose: the identity
 * provider and apps on other sites load it without the Portal's cookie, and a
 * new picture gets a new name, so the file can be cached for good.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const bytes = await readPictureFile(file);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
