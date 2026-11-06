import { apiUser, unauthorized } from "@/lib/api-v1";
import { codeOpen, db, shareOf, shotBytes, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string; name: string }> };

const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** A screenshot the agent took. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  const share = shareOf(request);
  if (!user && !share) return unauthorized();
  const { id, name } = await params;
  return codeOpen(user, async () => {
    const bytes = await shotBytes(workspaceAs(db(), id, user?.username ?? null, "read", share), decodeURIComponent(name));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": types[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=604800, immutable",
      },
    });
  });
}
