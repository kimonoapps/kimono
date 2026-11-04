import { open } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { apiError, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { addFile, db, drive, DriveProblem, endUpload, newId, recordReceived, root, uploadFor } from "@/lib/drive";
import { keepUpload, partPath, removePart } from "@/lib/drive/storage";
import { tusHeaders } from "@/lib/drive/tus";

type Context = { params: Promise<{ id: string }> };

/* One PATCH at a time per upload, so two writers can't interleave bytes. */
const writing = new Set<string>();

/** How much has arrived, so a client can carry on where it stopped. */
export async function HEAD(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  try {
    const upload = uploadFor(db(), id, user.username);
    return new Response(null, { status: 200, headers: { ...tusHeaders, "Upload-Offset": String(upload.received), "Upload-Length": String(upload.size) } });
  } catch {
    return new Response(null, { status: 404, headers: tusHeaders });
  }
}

/** The next run of bytes, starting exactly where the last one ended. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (request.headers.get("content-type") !== "application/offset+octet-stream") return apiError(415, "Send bytes as application/offset+octet-stream.");
  const { id } = await params;
  if (writing.has(id)) return apiError(409, "That upload is already receiving bytes.");
  writing.add(id);
  try {
    return await drive(async () => {
      const upload = uploadFor(db(), id, user.username);
      if (Number(request.headers.get("upload-offset")) !== upload.received) {
        return new Response(null, { status: 409, headers: { ...tusHeaders, "Upload-Offset": String(upload.received) } });
      }
      const path = partPath(root, id);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, "a", 0o600);
      let received = upload.received;
      let tooBig = false;
      try {
        if (request.body) {
          const reader = request.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (received + value.byteLength > upload.size) { tooBig = true; await reader.cancel(); break; }
            await handle.write(value);
            received += value.byteLength;
          }
        }
      } finally {
        /* Whatever arrived before a dropped connection still counts. */
        await handle.close();
        recordReceived(db(), id, received);
      }
      if (tooBig) {
        await handle.close().catch(() => {});
        throw new DriveProblem("That's more than the size you said the file was.", 413);
      }
      const headers: Record<string, string> = { ...tusHeaders, "Upload-Offset": String(received) };
      if (received === upload.size) {
        const blob = newId();
        await keepUpload(root, id, blob);
        const node = addFile(db(), upload.parentId, user.username, { name: upload.name, size: upload.size, mime: upload.mime, blob });
        endUpload(db(), id);
        headers["Kimono-File"] = node.id;
      }
      return new Response(null, { status: 204, headers });
    });
  } finally {
    writing.delete(id);
  }
}

/** Gives up on an upload and throws its bytes away. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(async () => {
    uploadFor(db(), id, user.username);
    endUpload(db(), id);
    await removePart(root, id);
    return new Response(null, { status: 204, headers: tusHeaders });
  });
}
