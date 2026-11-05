import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, ensure, CodeProblem, db, published, setPullRequest, syncDrive, who, workspaceFor, requireProject } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** Commits what's there, pushes the branch and opens a pull request: `{ title?, body? }`. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    requireProject(user, workspace);
    if (workspace.turn?.state === "running") throw new CodeProblem("Wait for the agent to finish first.", 409);
    const body = read.body as { title?: unknown; body?: unknown };
    const title = String(body.title ?? "").trim() || workspace.title;
    await ensure(config, workspace, who(user));
    const pr = await sandbox.publish(config, workspace, { title, body: String(body.body ?? "").trim() });
    if (workspace.pullRequest?.number !== pr.number) published(workspace, pr);
    setPullRequest(db(), id, pr);
    void syncDrive(db(), config, workspace).catch(() => {});
    return apiJson(workspaceFor(db(), id, user.username));
  });
}
