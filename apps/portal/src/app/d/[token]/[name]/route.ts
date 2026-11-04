import { blobPath, db, publicFile, root, sendFile, typeOf } from "@/lib/drive";

/**
 * 公 A public link. Anyone with the address gets the file, with no sign-in,
 * served as itself so Discord and chat apps embed images and video directly.
 * The name in the address is for people and players; the token decides.
 */
async function serve(request: Request, { params }: { params: Promise<{ token: string; name: string }> }) {
  const { token } = await params;
  const file = /^[A-Za-z0-9_-]{8,32}$/.test(token) ? publicFile(db(), token) : null;
  if (!file) return new Response("This link doesn't work any more.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  return sendFile(request, blobPath(root, file.blob), { name: file.name, size: file.size, type: typeOf(file.name), etag: file.blob, shared: true });
}

export const GET = serve;
export const HEAD = serve;
