import { apiJson, readJson } from "@/lib/api-v1";
import { redeemTicket } from "@/lib/kimono-read";
import { readFailure } from "../../errors";

/** The reader trades a setup ticket for its token: `{ ticket, deviceId, model }` → `{ token, username }`. */
export async function POST(request: Request) {
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try { return apiJson(redeemTicket(read.body as Record<string, unknown>)); }
  catch (error) { return readFailure(error); }
}
