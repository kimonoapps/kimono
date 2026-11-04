import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { apiError, apiUser, crossSite } from "@/lib/api-v1";
import { db, drive, DriveProblem, endUpload, finishUpload, newId, recordReceived, root, uploadFor, type Upload } from "@/lib/drive";
import { keepUpload, partPath, removeBlob, removePart } from "@/lib/drive/storage";
import { tusHeaders } from "@/lib/drive/tus";

type Context = { params: Promise<{ id: string }> };

/*
 * Every byte that reaches the disk counts, so an upload resumes from exactly
 * where it stopped, even halfway through one of its pieces. Progress is
 * flushed to disk and recorded every few megabytes as bytes arrive, and the
 * partial file is checked against the record before writing, so a crash or
 * power cut at any point loses only the last few megabytes, never the upload.
 */
const checkpointBytes = 8 * 1024 * 1024;

/* One writer per upload. A newer request takes over from an older one, whose connection is gone as far as the client knows. */
const writers = new Map<string, { stop: () => void; done: Promise<void> }>();

async function takeOver(id: string) {
  const writer = writers.get(id);
  if (!writer) return;
  writer.stop();
  await writer.done;
}

/** Members' uploads are theirs; a guest's is reached by its id alone, while the link still lets people add. */
async function uploadOf(id: string): Promise<Upload> {
  const user = await apiUser();
  return uploadFor(db(), id, user?.username ?? null);
}

/** The bytes really on disk, reconciled with the record: a crash can leave the two apart. */
async function settle(upload: Upload): Promise<number> {
  const path = partPath(root, upload.id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "a", 0o600);
  try {
    const onDisk = (await handle.stat()).size;
    if (onDisk > upload.received) await handle.truncate(upload.received);
    if (onDisk < upload.received) recordReceived(db(), upload.id, onDisk);
    return Math.min(onDisk, upload.received);
  } finally {
    await handle.close();
  }
}

/** How much has arrived, so a client can carry on where it stopped. */
export async function HEAD(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    await takeOver(id);
    const upload = await uploadOf(id);
    const received = await settle(upload);
    return new Response(null, { status: 200, headers: { ...tusHeaders, "Upload-Offset": String(received), "Upload-Length": String(upload.size) } });
  } catch {
    return new Response(null, { status: 404, headers: tusHeaders });
  }
}

/** The next run of bytes, starting exactly where the last one ended. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  if (request.headers.get("content-type") !== "application/offset+octet-stream") return apiError(415, "Send bytes as application/offset+octet-stream.");
  const { id } = await params;
  await takeOver(id);
  let stopped = false;
  let finished!: () => void;
  const reader = request.body?.getReader();
  const writer = { stop: () => { stopped = true; void reader?.cancel().catch(() => {}); }, done: new Promise<void>((resolve) => { finished = resolve; }) };
  writers.set(id, writer);
  try {
    return await drive(async () => {
      const upload = await uploadOf(id);
      const start = await settle(upload);
      if (Number(request.headers.get("upload-offset")) !== start) {
        return new Response(null, { status: 409, headers: { ...tusHeaders, "Upload-Offset": String(start) } });
      }
      const handle = await open(partPath(root, id), "a", 0o600);
      let received = start, recorded = start, tooBig = false;
      const checkpoint = async () => {
        if (received === recorded) return;
        await handle.datasync();
        recordReceived(db(), id, received);
        recorded = received;
      };
      try {
        while (reader && !stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          if (received + value.byteLength > upload.size) { tooBig = true; await reader.cancel(); break; }
          await handle.write(value);
          received += value.byteLength;
          if (received - recorded >= checkpointBytes) await checkpoint();
        }
      } catch {
        /* The connection dropped. What arrived is kept below, and the client resumes from it. */
      } finally {
        await checkpoint().catch(() => {});
        await handle.close();
      }
      if (tooBig) throw new DriveProblem("That's more than the size you said the file was.", 413);
      const headers: Record<string, string> = { ...tusHeaders, "Upload-Offset": String(received) };
      if (received === upload.size) {
        const blob = newId();
        await keepUpload(root, id, blob);
        try {
          const done = finishUpload(db(), upload, blob);
          headers["Kimono-File"] = done.node.id;
          headers["Kimono-Version"] = String(done.node.version);
          headers["Kimono-Content-Version"] = String(done.node.contentVersion);
          if (done.conflict) headers["Kimono-Conflict"] = "kept-as-copy";
          if (done.oldBlob) await removeBlob(root, done.oldBlob);
        } catch (error) {
          await removeBlob(root, blob);
          endUpload(db(), id);
          throw error;
        }
      }
      return new Response(null, { status: 204, headers });
    });
  } finally {
    if (writers.get(id) === writer) writers.delete(id);
    finished();
  }
}

/** Gives up on an upload and throws its bytes away. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const { id } = await params;
  return drive(async () => {
    await takeOver(id);
    await uploadOf(id);
    endUpload(db(), id);
    await removePart(root, id);
    return new Response(null, { status: 204, headers: tusHeaders });
  });
}
