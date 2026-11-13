import { apiJson, readJson } from "@/lib/api-v1";
import { startPairing } from "@/lib/kimono-read";
import { readFailure } from "../../errors";

/**
 * A Kimono Read asks to be paired: `{ deviceId, model, secret }`, no sign-in.
 * It shows the code (and a QR code of `url`) for the person to approve on a
 * signed-in phone, then polls /pair/claim with the same secret.
 */
export async function POST(request: Request) {
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try {
    const pairing = startPairing(read.body as Record<string, unknown>);
    const origin = new URL(request.url).origin;
    const base = (process.env.KIMONO_PORTAL_URL || origin).replace(/\/+$/, "");
    return apiJson({ ...pairing, url: `${base}/read/pair?code=${pairing.code}` }, 201);
  } catch (error) { return readFailure(error); }
}
