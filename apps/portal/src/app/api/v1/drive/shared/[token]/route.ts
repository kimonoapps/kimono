import { apiJson } from "@/lib/api-v1";
import { db, drive, publicLinksAllowed, sharedFolder } from "@/lib/drive";

/** A folder of a space opened by its link, for anyone holding it; `?folder=` for one below the top. No sign-in. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const folder = new URL(request.url).searchParams.get("folder") ?? undefined;
  return drive(async () => {
    await publicLinksAllowed();
    const response = apiJson(sharedFolder(db(), token, folder));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  });
}
