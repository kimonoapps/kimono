import { auth } from "@/auth";
import { crossSite } from "@/lib/api-v1";
import { startCloudflareLogin } from "@/lib/cloudflare-login";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const refused = crossSite(request);
  if (refused) return refused;
  const session = await auth();
  if (!session?.user || (session.user.role !== "owner" && session.user.role !== "admin")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = await (request.headers.get("content-type")?.startsWith("application/json") ? request.json() : Promise.reject(new Error("Send JSON."))) as { name?: string; domain?: string };
    return NextResponse.json(await startCloudflareLogin({ name: input.name || "", domain: input.domain || "" }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare login could not start" }, { status: 400 });
  }
}
