import { apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, DriveProblem, nodeFor, root, sendThumb } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** A small picture of an image file (?w=256 or 1280), made once and kept. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => {
    const node = nodeFor(db(), id, user.username);
    if (node.kind !== "file" || !node.blob) throw new DriveProblem("That's a folder.");
    return sendThumb(root, { blob: node.blob, name: node.name, shared: false }, new URL(request.url).searchParams.get("w"));
  });
}
