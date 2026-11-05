import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { projectMissing } from "@/lib/code/config";
import { ask, checkShare, code, requireProject, createWorkspace, db, efforts, taskFolder, workspaceFor, workspacesOf, type Attachment, type Effort } from "@/lib/code";

/** Your workspaces, the most recently active first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, () => apiJson({ workspaces: workspacesOf(db(), user.username) }), false);
}

/**
 * Starts a workspace from what you ask: `{ owner, name, base, prompt }`. The
 * sandbox is made and the agent starts on the prompt straight away. Files are
 * attached to a workspace once it exists, so a first message carries none.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, (config) => {
    const body = read.body as { owner?: unknown; name?: unknown; base?: unknown; prompt?: unknown; effort?: unknown };
    /* Out of share: say so before a task is made that couldn't start. */
    checkShare(config, user);
    if (body.owner || body.name) {
      requireProject(user);
      const blocked = projectMissing(config);
      if (blocked) return apiError(409, blocked);
    }
    const made = createWorkspace(db(), user.username, { repoOwner: body.owner, repoName: body.name, base: body.base, prompt: body.prompt });
    ask(config, made, user, String(body.prompt), [] as Attachment[], efforts.includes(body.effort as Effort) ? body.effort as Effort : undefined);
    void taskFolder(db(), made).catch((error) => console.warn("Code couldn't make a Drive folder:", error instanceof Error ? error.message : error));
    return apiJson(workspaceFor(db(), made.id, user.username), 201);
  });
}
