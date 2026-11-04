import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { packageFor } from "@/lib/app-releases";

/** A published Android package, for the app to install over itself. */
export async function GET(_request: Request, { params }: { params: Promise<{ build: string }> }) {
  const found = await packageFor(Number((await params).build));
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(found.path)) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(found.size),
      "Content-Disposition": `attachment; filename="kimono-${found.version}.apk"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
