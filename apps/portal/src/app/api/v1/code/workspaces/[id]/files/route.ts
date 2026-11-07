import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, ownersOnly, readFromSandbox, db, syncDrive, who, workspaceAs, shareOf } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** A folder in the sandbox's copy of the repository: `?path=` (empty for the top). */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") || "";
  return code(user, async (config) => {
    const workspace = workspaceAs(db(), id, user.username, "read", shareOf(request));
    ownersOnly(workspace, path);
    return apiJson(await readFromSandbox(config, workspace, who(user), async () => {
      /* Opening the files brings Drive's edits in first, so what is shown is what both hold. */
      if (!path) await syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync with Drive:", error instanceof Error ? error.message : error));
      const listing = await sandbox.files(config, workspace, path);
      if (workspace.access === "owner") return listing;
      return { ...listing, entries: listing.entries.filter((entry) => !(entry.name === ".kimono" && !listing.path.replace(/^\.?\/?/, ""))) };
    }));
  });
}
