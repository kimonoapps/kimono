import { apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, shotBytes, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string; name: string }> };

const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** A screenshot the agent took. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id, name } = await params;
  return code(user, async () => {
    const bytes = await shotBytes(workspaceFor(db(), id, user.username), decodeURIComponent(name));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": types[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=604800, immutable",
      },
    });
  }, false);
}
