import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, syncDrive, who, workspaceFor } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** A folder in the sandbox's copy of the repository: `?path=` (empty for the top). */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") || "";
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    await sandbox.ensure(config, workspace, who(user));
    /* Opening the files brings Drive's edits in first, so what is shown is what both hold. */
    if (!path) await syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync with Drive:", error instanceof Error ? error.message : error));
    return apiJson(await sandbox.files(config, workspace, path));
  });
}
