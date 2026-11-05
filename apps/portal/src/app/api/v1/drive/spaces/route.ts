import { withMark } from "@/lib/drive/marks";
import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { createSpace, db, drive, spacesOf } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";
import { db as codeDb, driveSpaceOf } from "@/lib/code";
import { codeIdentity } from "@/lib/code/config";
import { getPlatformSettings } from "@/lib/settings";

/** Which of your spaces is Code's, and Code's colour, so Drive can show it as Code's own place. */
async function codeSpace(username: string) {
  try {
    const id = driveSpaceOf(codeDb(), username);
    return id ? { id, accent: (await codeIdentity(await getPlatformSettings())).accent } : null;
  } catch { return null; } /* Code isn't set up here */
}

/** The spaces you are in. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const code = await codeSpace(user.username);
  return drive(() => apiJson({ spaces: spacesOf(db(), user.username).map(withMark)
    .map((space) => space.id === code?.id ? { ...space, code: { accent: code.accent } } : space) }));
}

/** Makes a space: `{ name, crest?, color?, members?: [{ username, role }] }`. You own it. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return drive(async () => {
    const body = read.body as { name?: unknown; crest?: unknown; color?: unknown; members?: unknown };
    const members = await knownMembers(body.members);
    return apiJson(withMark(createSpace(db(), user.username, { name: body.name, crest: body.crest, color: body.color, members })), 201);
  });
}

