import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { accessOf, artifactByLink, chatOfLink, codeOpen, db, joinByLink, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ token: string }> };

/**
 * What a share link opens, for whoever has it (signed in or not):
 * a chat, `{ kind: "chat", id, title, owner, access }`, to read with `?share=<token>`;
 * or an artifact, `{ kind: "artifact", name, title, content, version, owner }`.
 */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  const { token } = await params;
  return codeOpen(user, () => {
    const chat = chatOfLink(db(), token);
    if (chat) {
      const owner = (db().prepare("SELECT owner FROM workspaces WHERE id = ?").get(chat.workspaceId) as { owner: string }).owner;
      const workspace = workspaceFor(db(), chat.workspaceId, owner);
      return apiJson({ kind: "chat", id: workspace.id, title: workspace.title, owner, access: accessOf(db(), workspace.id, user?.username ?? null, token) });
    }
    const artifact = artifactByLink(db(), token, user?.username ?? null);
    return apiJson({ kind: "artifact", name: artifact.name, title: artifact.title, content: artifact.content, version: artifact.version, updatedAt: artifact.updatedAt, owner: artifact.owner, public: artifact.public, media: artifact.media });
  });
}

/** A signed-in person keeps a chat link: the chat is theirs to come back to, to read, or to write in when the link allows. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { token } = await params;
  return codeOpen(user, () => apiJson(joinByLink(db(), token, user.username)));
}
