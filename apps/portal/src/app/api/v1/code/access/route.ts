import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { alwaysGrants } from "@/lib/code/access";
import { db as driveDb, spacesOf } from "@/lib/drive";

/** What Kimono AI may use without asking: each space, and every always permission. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => {
    const grants = alwaysGrants(db(), user.username);
    const spaces = spacesOf(driveDb(), user.username).map((s) => ({
      id: s.id, name: s.name, crest: s.crest, color: s.color, canChange: s.role !== "viewer",
      auto: grants.find((g) => g.spaceId === s.id && !g.path)?.need ?? null,
    }));
    return apiJson({ spaces, grants: grants.filter((g) => g.path) });
  }, false);
}
