import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { approvePairing, pairingFor } from "@/lib/kimono-read";
import { readFailure } from "../errors";

/** `?code=`: the reader asking to be paired, for the person to check before pairing it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  try { return apiJson(pairingFor(new URL(request.url).searchParams.get("code"))); }
  catch (error) { return readFailure(error); }
}

/** `{ code }`: pairs the reader showing this code with your account. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try { return apiJson(approvePairing((read.body as { code?: unknown }).code, user.username)); }
  catch (error) { return readFailure(error); }
}
