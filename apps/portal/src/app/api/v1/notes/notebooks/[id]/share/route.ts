import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, folderToSpace } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";
import { notebookFor, notes } from "@/lib/notes";

/**
 * Shares a notebook on its own, with the people named: `{ members: [{ username, role }] }`.
 * It leaves its space for one of its own (only you and them), still a notebook. Owners of its space only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(async () => {
    notebookFor(db(), id, user.username, "owner");
    folderToSpace(db(), id, user.username, { crest: "kikyo", members: await knownMembers((read.body as { members?: unknown }).members) });
    return apiJson(notebookFor(db(), id, user.username), 201);
  });
}
