import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, sharedWithMe, typersIn, workspacesOf } from "@/lib/code";

/** Who is typing now in the chats this person is in: { [chat]: [username] }, only the chats someone is. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, () => {
    const ids = [...workspacesOf(db(), user.username), ...sharedWithMe(db(), user.username)].map((w) => w.id);
    return apiJson({ typing: typersIn(ids, user.username) });
  }, false);
}
