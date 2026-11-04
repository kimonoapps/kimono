import { apiError, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { db, drive, DriveProblem, maxFileBytes, promisedBytes, root, startUpload, typeOf } from "@/lib/drive";
import { freeBytes, reserveBytes } from "@/lib/drive/storage";
import { tusHeaders } from "@/lib/drive/tus";

/**
 * Resumable uploads, speaking tus 1.0 (core, creation, termination) so the
 * ready-made clients for browsers and Android work as they are. An upload is
 * created here with its size and name; its bytes arrive in PATCHes to the
 * address this returns, and the file appears in the folder when the last byte
 * lands. Files can be up to 150 GB. Send chunks of 50 MB or less (some
 * proxies refuse bigger requests); an upload that receives nothing for seven
 * days is thrown away, so a big file can be resumed over several days.
 *
 *   Upload-Length: <bytes>
 *   Upload-Metadata: filename <base64>, folder <base64>
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (request.headers.get("tus-resumable") !== "1.0.0") return apiError(412, "Use tus 1.0.0.");
  return drive(async () => {
    const size = Number(request.headers.get("upload-length"));
    const meta = metadata(request.headers.get("upload-metadata"));
    if (!meta.folder) throw new DriveProblem("Say which folder the file goes in.");
    /* Room for this file and everything already on its way, with some left over. */
    if ((await freeBytes(root)) - promisedBytes(db()) - size < reserveBytes) throw new DriveProblem("Kimono's disk is too full for that file.", 507);
    const upload = startUpload(db(), meta.folder, user.username, { name: meta.filename, size, mime: typeOf(meta.filename ?? "") }, maxFileBytes);
    return new Response(null, { status: 201, headers: { ...tusHeaders, Location: `/api/v1/drive/uploads/${upload.id}`, "Upload-Offset": "0" } });
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...tusHeaders, "Tus-Version": "1.0.0", "Tus-Extension": "creation,termination", "Tus-Max-Size": String(maxFileBytes) } });
}

function metadata(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (header ?? "").split(",")) {
    const [key, value] = pair.trim().split(" ");
    if (key) out[key] = value ? Buffer.from(value, "base64").toString("utf8") : "";
  }
  return out;
}
