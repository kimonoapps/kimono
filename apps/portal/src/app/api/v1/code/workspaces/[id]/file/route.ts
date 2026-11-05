import { apiUser, unauthorized } from "@/lib/api-v1";
import { code, ensure, db, who, workspaceFor } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** One file's bytes: `?path=`. Never rendered as a page, only read by Code's viewer. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") || "";
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    await ensure(config, workspace, who(user));
    const response = await sandbox.file(config, workspace, path);
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store",
      },
    });
  });
}
