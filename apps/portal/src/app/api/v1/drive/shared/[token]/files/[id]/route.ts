import { blobPath, db, drive, root, sendFile, sharedFile, typeOf } from "@/lib/drive";

/** A file's bytes from a space opened by its link, with ranges for seeking. No sign-in. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  return drive(() => {
    const file = sharedFile(db(), token, id);
    return sendFile(request, blobPath(root, file.blob), { name: file.name, size: file.size, type: typeOf(file.name), etag: file.blob, shared: true });
  });
}
export const HEAD = GET;
