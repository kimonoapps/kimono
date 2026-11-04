import { apiError, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { db, drive, DriveProblem, largestFile, publicLinksAllowed, promisedBytes, root, startGuestUpload, startReplace, startUpload, typeOf } from "@/lib/drive";
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
 *
 * To replace an existing file's bytes (an edit saved from another app),
 * send `replaces <file id>` and `base <its contentVersion when the edit
 * began>` instead of `folder`. If someone else's edit landed first, the new
 * bytes are kept beside it as a copy (Kimono-Conflict: kept-as-copy).
 *
 * Someone without an account adds files through a space's link instead,
 * when it lets people add: they send `link` (and `name`, if they give one)
 * in the metadata, `folder` being optional, and no sign-in.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  if (request.headers.get("tus-resumable") !== "1.0.0") return apiError(412, "Use tus 1.0.0.");
  const meta = metadata(request.headers.get("upload-metadata"));
  const user = meta.link === undefined ? await apiUser() : null;
  if (!user && meta.link === undefined) return unauthorized();
  return drive(async () => {
    const size = Number(request.headers.get("upload-length"));
    const file = { name: meta.filename, size, mime: typeOf(meta.filename ?? "") };
    if (user && !meta.folder && !meta.replaces) throw new DriveProblem("Say which folder the file goes in.");
    if (!user) await publicLinksAllowed();
    const limit = await largestFile();
    /* Room for this file and everything already on its way, with some left over. */
    if ((await freeBytes(root)) - promisedBytes(db()) - size < reserveBytes) throw new DriveProblem("Kimono's disk is too full for that file.", 507);
    const upload = user && meta.replaces
      ? startReplace(db(), meta.replaces, user.username, Number(meta.base), file, limit)
      : user
      ? startUpload(db(), meta.folder, user.username, file, limit)
      : startGuestUpload(db(), meta.link, meta.folder, meta.name, file, limit);
    return new Response(null, { status: 201, headers: { ...tusHeaders, Location: `/api/v1/drive/uploads/${upload.id}`, "Upload-Offset": "0" } });
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...tusHeaders, "Tus-Version": "1.0.0", "Tus-Extension": "creation,termination", "Tus-Max-Size": String(await largestFile()) } });
}

function metadata(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (header ?? "").split(",")) {
    const [key, value] = pair.trim().split(" ");
    if (key) out[key] = value ? Buffer.from(value, "base64").toString("utf8") : "";
  }
  return out;
}
