import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { notes } from "@/lib/notes";
import { join, listen, moveCursor, push, type LiveEvent } from "@/lib/notes/live";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const clientOf = (raw: unknown) => typeof raw === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null;

/**
 * Writing a note together (lib/notes/live.ts). Asked for JSON: the text now
 * and its change number, to start from. Asked for `text/event-stream` with
 * `?client=<id>` and `?version=<n>` (or `Last-Event-ID`): every change after
 * that, as it is made, and where everyone's cursor is. An event `reset` means
 * the page starts again from the JSON.
 */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const url = new URL(request.url);
  return notes(async () => {
    if (!request.headers.get("accept")?.includes("text/event-stream")) {
      const response = apiJson(await join(id, user.username));
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const client = clientOf(url.searchParams.get("client"));
    if (!client) return apiError(400, "Say which page this is.");
    const from = Number(request.headers.get("last-event-id") ?? url.searchParams.get("version") ?? 0) || 0;
    const encoder = new TextEncoder();
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let at = from;
        const write = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { close(); } };
        const send = (event: LiveEvent) => {
          if (event.type === "updates") { at = event.from + event.updates.length; write(`id: ${at}\nevent: updates\ndata: ${JSON.stringify(event)}\n\n`); }
          else write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (event.type === "gone") close();
        };
        const stop = await listen(id, user.username, client, from, send).catch(() => null);
        if (!stop) { write("event: reset\ndata: {}\n\n"); try { controller.close(); } catch { /* closed */ } return; }
        const beat = setInterval(() => write(": still here\n\n"), 15_000);
        close = () => { clearInterval(beat); stop(); try { controller.close(); } catch { /* already closed */ } };
        request.signal.addEventListener("abort", () => close());
        void at;
      },
      cancel() { close(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  });
}

/**
 * `{ client, version, updates?: [{ changes }], cursor?: { anchor, head } }`:
 * changes made on that page after [version] changes, and/or where its cursor
 * is. 409 when the page is behind; it takes the changes it missed and sends again.
 */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  const body = read.body as { client?: unknown; version?: unknown; updates?: unknown; cursor?: { anchor?: unknown; head?: unknown } };
  const client = clientOf(body.client);
  const version = Number(body.version);
  if (!client || !Number.isSafeInteger(version) || version < 0) return apiError(400, "Say which page this is and what it has seen.");
  return notes(async () => {
    if (Array.isArray(body.updates) && body.updates.length) {
      if (body.updates.length > 200) return apiError(413, "That's too many changes at once.");
      const ok = await push(id, user.username, client, version, body.updates as { changes: unknown }[]);
      if (!ok) return apiError(409, "Someone changed it first.");
    }
    const cursor = body.cursor;
    if (cursor && Number.isSafeInteger(cursor.anchor) && Number.isSafeInteger(cursor.head)) {
      await moveCursor(id, user.username, client, version + (Array.isArray(body.updates) ? body.updates.length : 0), cursor.anchor as number, cursor.head as number);
    }
    return apiJson({ ok: true });
  });
}
