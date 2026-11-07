import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { db, nodeFor, restoreNode } from "@/lib/drive";
import { noteFrom, notes } from "@/lib/notes";

/** Brings a trashed note (or section) back where it was. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(() => {
    const node = restoreNode(db(), id, user.username);
    if (node.kind === "folder") return apiJson({ restored: true });
    const { blob, ...note } = noteFrom(db(), nodeFor(db(), node.id, user.username));
    void blob;
    return apiJson(note);
  });
}
