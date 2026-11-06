import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, eventsAfter, listen, workspaceFor, type StoredEvent } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * The workspace's timeline after `?after=<seq>` (or `Last-Event-ID`).
 * Asked for `text/event-stream`, it stays open and sends each event as it is
 * recorded; otherwise it answers once in JSON, which is what the phone polls.
 */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const url = new URL(request.url);
  const after = Number(request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  return code(user, () => {
    const workspace = workspaceFor(db(), id, user.username);
    if (!request.headers.get("accept")?.includes("text/event-stream")) {
      return apiJson({ workspace, events: eventsAfter(db(), id, after) });
    }
    const encoder = new TextEncoder();
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let sent = after;
        const send = (stored: StoredEvent) => {
          /* seq 0 is something passing (what it is writing now): sent, never kept, never counted */
          if (stored.seq === 0) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(stored)}\n\n`)); } catch { close(); } return; }
          if (stored.seq <= sent) return;
          sent = stored.seq;
          controller.enqueue(encoder.encode(`id: ${stored.seq}\ndata: ${JSON.stringify(stored)}\n\n`));
        };
        /* Listen first, then replay, so nothing recorded in between is missed. */
        const stopListening = listen(workspace.id, send);
        for (const stored of eventsAfter(db(), id, after, 100_000)) send(stored);
        const beat = setInterval(() => { try { controller.enqueue(encoder.encode(": still here\n\n")); } catch { close(); } }, 15_000);
        close = () => { clearInterval(beat); stopListening(); try { controller.close(); } catch { /* already closed */ } };
        request.signal.addEventListener("abort", () => close());
      },
      cancel() { close(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  }, false);
}
