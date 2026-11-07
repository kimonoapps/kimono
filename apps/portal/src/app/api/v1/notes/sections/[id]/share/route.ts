import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, folderToSpace } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";
import { notes, placeFor } from "@/lib/notes";

/** Shares a section as a notebook of its own, with the people named: `{ members: [{ username, role }] }`. Owners only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(async () => {
    placeFor(db(), id, user.username);
    const space = folderToSpace(db(), id, user.username, { crest: "kikyo", members: await knownMembers((read.body as { members?: unknown }).members) });
    return apiJson({ id: space.id, name: space.name, rootId: space.rootId, role: space.role, members: space.members }, 201);
  });
}
