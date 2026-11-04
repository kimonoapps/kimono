import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, drive, folderToSpace } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";

/** Turns this folder into a space of its own: `{ crest?, members? }`. Owners only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(async () => {
    const body = read.body as { crest?: unknown; members?: unknown };
    return apiJson(folderToSpace(db(), id, user.username, { crest: body.crest, members: await knownMembers(body.members) }), 201);
  });
}
