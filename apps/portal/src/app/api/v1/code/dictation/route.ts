import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code } from "@/lib/code";

/*
 * Speaking a message instead of typing it. The page records until the person
 * is done, then sends the whole recording here once; gpt-transcribe, through OpenRouter,
 * turns it into words, which go into the message box to be read and sent.
 * Nothing is kept: the audio passes through and is gone.
 */

const model = "openai/gpt-transcribe";
/* OpenRouter takes files up to 25 MB; ten minutes of speech is far under that. */
const largest = 24 * 1024 * 1024;
/* OpenRouter tells formats apart by the file's name; AAC in MP4 (Safari, the phones) is an .m4a to it. */
const extension = (type: string) =>
  type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("aac") || type.includes("m4a") ? "m4a"
    : type.includes("wav") ? "wav" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : "webm";

/** Whether speaking a message is set up here. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, (config) => apiJson({ on: Boolean(config.openrouterKey) }), false);
}

/** A finished recording in, its words out: { text }. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => {
    if (!config.openrouterKey) return apiError(409, "Speaking a message isn't set up.");
    const type = (request.headers.get("content-type") || "audio/webm").split(";")[0].trim();
    if (!type.startsWith("audio/") && !type.startsWith("video/")) return apiError(415, "That isn't a recording.");
    const audio = await request.arrayBuffer();
    if (!audio.byteLength) return apiError(400, "Nothing was heard.");
    if (audio.byteLength > largest) return apiError(413, "That recording is too long.");

    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "json");
    form.append("file", new Blob([audio], { type }), `message.${extension(type)}`);

    let answer: Response;
    try {
      answer = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${config.openrouterKey}`, "X-Title": "Kimono" }, body: form, signal: AbortSignal.timeout(90_000),
      });
    } catch {
      return apiError(502, "Couldn't turn that into words. Try again.");
    }
    if (!answer.ok) {
      console.warn("Dictation failed:", answer.status, (await answer.text().catch(() => "")).slice(0, 300));
      return apiError(502, "Couldn't turn that into words. Try again.");
    }
    const { text } = (await answer.json().catch(() => ({}))) as { text?: string };
    return apiJson({ text: (text ?? "").trim() });
  }, false);
}
