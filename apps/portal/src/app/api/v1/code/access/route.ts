import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { alwaysGrants } from "@/lib/code/access";
import { codeSpaceOf } from "@/lib/code/drive";
import { db as driveDb, spacesOf } from "@/lib/drive";

/** What Kimono AI may use without asking: each space, and every always permission. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => {
    const grants = alwaysGrants(db(), user.username);
    /* The chats space reads without asking and is never changed from another chat: nothing to set. */
    const chats = codeSpaceOf(db(), user.username.toLowerCase());
    const spaces = spacesOf(driveDb(), user.username).filter((s) => s.id !== chats).map((s) => ({
      id: s.id, name: s.name, crest: s.crest, color: s.color, canChange: s.role !== "viewer",
      auto: grants.find((g) => g.spaceId === s.id && !g.path)?.need ?? null,
    }));
    return apiJson({ spaces, grants: grants.filter((g) => g.path) });
  }, false);
}
