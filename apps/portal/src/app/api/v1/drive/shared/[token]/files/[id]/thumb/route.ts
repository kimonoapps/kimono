import { db, drive, publicLinksAllowed, root, sendThumb, sharedFile } from "@/lib/drive";

/** A small picture of an image file in a space opened by its link. No sign-in. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  return drive(async () => {
    await publicLinksAllowed();
    const file = sharedFile(db(), token, id);
    return sendThumb(root, { blob: file.blob, name: file.name, shared: true }, new URL(request.url).searchParams.get("w"));
  });
}
