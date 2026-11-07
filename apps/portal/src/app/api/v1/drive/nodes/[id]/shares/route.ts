import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { listAccounts } from "@/lib/directory";
import { db, drive, DriveProblem, sharesOn, shareNode } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** Who a folder or file is shared with beyond its space, and who has it through a folder above. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => apiJson(sharesOn(db(), id, user.username)));
}

/** Shares it with someone, changes what they may do, or (role null) takes them off: `{ username, role: "editor" | "viewer" | null }`. */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(async () => {
    const body = read.body as { username?: unknown; role?: unknown };
    if (typeof body.username !== "string") throw new DriveProblem("Say who to share it with.");
    const leaving = body.role === null;
    if (!leaving && body.role !== "editor" && body.role !== "viewer") throw new DriveProblem("They can edit it or view it.");
    if (!leaving && !(await listAccounts()).some((a) => a.username.toLowerCase() === (body.username as string).toLowerCase())) throw new DriveProblem(`There's no Kimono account called ${body.username}.`);
    const info = shareNode(db(), id, user.username, body.username, leaving ? null : body.role as "editor" | "viewer");
    return apiJson(leaving && body.username.toLowerCase() === user.username.toLowerCase() ? { left: true } : info);
  });
}
