import { apiJson, readJson } from "@/lib/api-v1";
import { claimPairing } from "@/lib/kimono-read";
import { readFailure } from "../../errors";

/** The reader collects its token: `{ deviceId, secret }` → 202 while waiting, then `{ token, username }` once. */
export async function POST(request: Request) {
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try {
    const result = claimPairing(read.body as Record<string, unknown>);
    return "pending" in result ? apiJson({ pending: true }, 202) : apiJson(result);
  } catch (error) { return readFailure(error); }
}
