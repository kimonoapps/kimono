import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { watch } from "@/lib/watch";
import { cleanClient, cleanPartyId } from "@/lib/watch/together";
import { act, listen, partyNow, type LiveEvent } from "@/lib/watch/together-live";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * A watch party. Asked for JSON: `{ state, chat }` now. Asked for
 * `text/event-stream` with `?client=<id>`: `state` now and after every change
 * (newest seq wins), `chat` (the lines so far, then each new one), `react`,
 * `ping` every 10 s with the server's clock, and `ended`. The screen counts
 * as here while it listens.
 */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = cleanPartyId((await params).id);
  if (!id) return apiError(404, "This watch party has ended.");
  return watch(async () => {
    if (!request.headers.get("accept")?.includes("text/event-stream")) return apiJson(partyNow(id, user.username));
    const client = cleanClient(new URL(request.url).searchParams.get("client"));
    if (!client) return apiError(400, "Say which screen this is.");
    const encoder = new TextEncoder();
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { close(); } };
        const send = (event: LiveEvent) => {
          if (event.type === "state") write(`id: ${event.state.seq}\nevent: state\ndata: ${JSON.stringify(event.state)}\n\n`);
          else write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (event.type === "ended") close();
        };
        write("retry: 1500\n\n");
        const stop = listen(id, client, user.username, send);
        if (!stop) { write("event: ended\ndata: {}\n\n"); try { controller.close(); } catch { /* closed */ } return; }
        const beat = setInterval(() => write(`event: ping\ndata: {"now":${Date.now()}}\n\n`), 10_000);
        close = () => { clearInterval(beat); stop(); try { controller.close(); } catch { /* already closed */ } };
        request.signal.addEventListener("abort", () => close());
      },
      cancel() { close(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  });
}

/**
 * Something a screen does: `{ client, seq, type, … }` (lib/watch/together-live.ts).
 * Answers `{ ok, state }`; 409 with `reason: "stale"` when someone else moved
 * the timeline first (the state that won comes with it), 403 when only the host can.
 */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = cleanPartyId((await params).id);
  if (!id) return apiError(404, "This watch party has ended.");
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(async (cfg) => {
    const { status, body } = await act(cfg, id, user.username, (read.body ?? {}) as Record<string, unknown>);
    return apiJson(body, status);
  });
}
