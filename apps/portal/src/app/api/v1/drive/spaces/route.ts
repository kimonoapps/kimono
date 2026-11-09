import { withMark } from "@/lib/drive/marks";
import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { createSpace, db, drive, spacesOf } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";
import { db as codeDb, driveSpaceOf } from "@/lib/code";
import { codeIdentity } from "@/lib/code/config";
import { nameAiSpace } from "@/lib/code/drive";
import { notesIdentity } from "@/lib/notes/config";
import { getPlatformSettings } from "@/lib/settings";

/** Which of your spaces is Code's, and Code's colour, so Drive can show it as Code's own place. */
async function codeSpace(username: string) {
  try {
    const id = driveSpaceOf(codeDb(), username);
    if (!id) return null;
    /* Its top-level folders that are code projects (a repository's), so only those wear the branch. */
    const repos = (codeDb().prepare("SELECT DISTINCT repo_name FROM workspaces WHERE owner = ? AND repo_name <> ''").all(username.toLowerCase()) as { repo_name: string }[]).map((r) => r.repo_name);
    return { id, accent: (await codeIdentity(await getPlatformSettings())).accent, repos };
  } catch { return null; } /* Code isn't set up here */
}

/** The spaces you are in. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const code = await codeSpace(user.username);
  /* Notes' colour, or its own default when its definition can't be read: the space is Notes' either way. */
  const notesAccent = await getPlatformSettings().then(notesIdentity).then((n) => n.accent, () => "#b56d78");
  return drive(() => {
    /* Kimono AI's space, still under a name it had before, takes its current one. */
    if (code) nameAiSpace(db(), code.id, user.username);
    return apiJson({ spaces: spacesOf(db(), user.username).map(withMark)
    .map((space) => space.id === code?.id ? { ...space, code: { accent: code.accent, repos: code.repos } }
      /* Your Notes space wears Notes' colour, as Kimono AI's wears its. */
      : space.purpose === "notes" && space.role === "owner" ? { ...space, notes: { accent: notesAccent } } : space) });
  });
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

