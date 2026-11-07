import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { projectMissing } from "@/lib/code/config";
import { ask, checkShare, code, requireProject, createWorkspace, db, efforts, modelChoices, taskFolder, workspaceFor, workspacesOf, sharedWithMe, artifactsSharedWith, type Attachment, type Effort, type ModelChoice } from "@/lib/code";
import { peopleIn } from "@/lib/code/sharing";

/** Your workspaces, the most recently active first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  /* Your own chats, then what others shared with you: chats to read or write in, and artifacts. Each names who else is in it. */
  return code(user, () => {
    const own = workspacesOf(db(), user.username);
    const shared = sharedWithMe(db(), user.username);
    const people = peopleIn(db(), [...own, ...shared].map((w) => ({ id: w.id, owner: w.owner })), user.username);
    const withPeople = <T extends { id: string }>(w: T) => people[w.id] ? { ...w, people: people[w.id] } : w;
    return apiJson({
      workspaces: own.map((w) => withPeople({ ...w, access: "owner" })),
      shared: shared.map(withPeople),
      sharedArtifacts: artifactsSharedWith(db(), user.username),
    });
  }, false);
}

/**
 * Starts a workspace from what you ask: `{ owner, name, base, prompt }`. The
 * sandbox is made and the agent starts on the prompt straight away. Files are
 * attached to a workspace once it exists, so a first message with files says
 * `hold: true`: the workspace is made, the files go to it, and the message
 * follows as an ordinary turn.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, (config) => {
    const body = read.body as { owner?: unknown; name?: unknown; base?: unknown; prompt?: unknown; effort?: unknown; model?: unknown; folder?: unknown; hold?: unknown };
    /* Out of share: say so before a task is made that couldn't start. */
    checkShare(config, user);
    if (body.owner || body.name) {
      requireProject(user);
      const blocked = projectMissing(config);
      if (blocked) return apiError(409, blocked);
    }
    const made = createWorkspace(db(), user.username, { repoOwner: body.owner, repoName: body.name, base: body.base, prompt: body.prompt, folder: body.folder });
    if (body.hold !== true) ask(config, made, user, String(body.prompt), [] as Attachment[], efforts.includes(body.effort as Effort) ? body.effort as Effort : undefined, modelChoices.includes(body.model as ModelChoice) ? body.model as ModelChoice : undefined);
    void taskFolder(db(), made).catch((error) => console.warn("Code couldn't make a Drive folder:", error instanceof Error ? error.message : error));
    return apiJson(workspaceFor(db(), made.id, user.username), 201);
  });
}
