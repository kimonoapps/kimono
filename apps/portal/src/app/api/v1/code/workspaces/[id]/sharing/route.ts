import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { linksOn, chatSharing, code, db, setChatLink, shareChat, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Who a chat is shared with, and its link: { people: [{ username, access }], link: { token, access } | null }. The owner's alone. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, (config) => apiJson(linksOn(config, chatSharing(db(), workspaceAs(db(), id, user.username, "owner").id))), false);
}

/** Invites someone (`{ username, access: "read" | "edit" }`), changes what they may do, or takes them off (`access: null`). */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  const body = read.body as { username?: unknown; access?: unknown };
  return code(user, (config) => apiJson(linksOn(config, shareChat(db(), workspaceAs(db(), id, user.username, "owner"), body.username, body.access ?? null))), false);
}

/** Turns the chat's link on (`{ link: "read" | "edit" }`: anyone reads; signed-in people may write) or off (`{ link: null }`). */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, (config) => apiJson(linksOn(config, setChatLink(db(), workspaceAs(db(), id, user.username, "owner"), (read.body as { link?: unknown }).link ?? null))), false);
}
