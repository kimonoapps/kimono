import { auth } from "@/auth";
import { publishRelease } from "@/lib/app-releases";

/** Publishes an Android version from the admin page: multipart, with the APK as `apk`. Owners and admins only. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "owner" && session.user.role !== "admin")) return Response.json({ error: "Only admins publish versions." }, { status: 403 });
  if (request.headers.get("origin") && new URL(request.url).origin !== request.headers.get("origin")) return Response.json({ error: "Publish from the admin page." }, { status: 403 });
  try {
    const form = await request.formData();
    const apk = form.get("apk");
    const bytes = apk instanceof File ? new Uint8Array(await apk.arrayBuffer()) : undefined;
    const release = await publishRelease({
      platform: "android",
      version: form.get("version"),
      build: form.get("build"),
      notes: form.get("notes"),
      required: form.get("required") === "on",
    }, session.user.username, bytes);
    return Response.json({ release: { ...release, file: undefined } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "That version couldn't be published." }, { status: 400 });
  }
}
