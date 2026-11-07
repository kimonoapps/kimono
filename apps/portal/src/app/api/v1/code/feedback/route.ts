import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, isAdmin } from "@/lib/code";
import { bank } from "@/lib/code/feedback";

/**
 * The feedback bank, for administrators: every rating and report since
 * `?since=<ms>`, without names. `?format=jsonl` gives one entry a line, for
 * handing to an AI to look for patterns.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!isAdmin(user)) return apiError(403, "The feedback bank is for administrators.");
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  return code(user, () => {
    const entries = bank(db(), Number.isFinite(since) ? since : 0);
    if (url.searchParams.get("format") !== "jsonl") return apiJson({ entries });
    return new Response(entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""), {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": "attachment; filename=\"kimono-ai-feedback.jsonl\"", "Cache-Control": "no-store" },
    });
  }, false);
}
