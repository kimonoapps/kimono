import { apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, shareOf, workspaceAs } from "@/lib/code";
import { report } from "@/lib/code/feedback";

type Context = { params: Promise<{ id: string }> };

/** Reports the whole chat (`{ reason? }`): it goes to the feedback bank with no name and nothing leading back to it. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  const reason = (read.body as { reason?: unknown }).reason;
  return code(user, () => {
    workspaceAs(db(), id, user.username, "read", shareOf(request));
    report(db(), id, typeof reason === "string" ? reason : "");
    return new Response(null, { status: 204 });
  }, false);
}
