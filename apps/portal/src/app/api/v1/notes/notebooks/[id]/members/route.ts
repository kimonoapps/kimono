import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, DriveProblem, setMember, spaceFor, type Role } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";
import { notebookFor, notes } from "@/lib/notes";

type Context = { params: Promise<{ id: string }> };

/* Who shares a notebook: everyone in its space. */
function notebook(id: string, username: string) {
  const book = notebookFor(db(), id, username);
  const space = spaceFor(db(), book.space.id, username);
  return { id: book.id, name: book.name, role: space.role, isSpace: book.isSpace, space: { id: space.id, name: space.name }, members: space.memberList };
}

/** Who shares a notebook: the people in its space. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(() => apiJson(notebook(id, user.username)));
}

/**
 * Adds, changes or (role null) removes someone: `{ username, role }`, for a
 * notebook that is a space of its own (share it first otherwise). Anyone may leave.
 */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(async () => {
    const book = notebook(id, user.username);
    if (!book.isSpace) throw new DriveProblem("It's shared with everyone in its space. Share it on its own first.", 409);
    const body = read.body as { username?: unknown; role?: unknown };
    if (typeof body.username !== "string") throw new DriveProblem("Say whose access to change.");
    const leaving = body.role === null;
    if (!leaving) await knownMembers([{ username: body.username, role: body.role }]);
    setMember(db(), book.space.id, user.username, body.username, leaving ? null : body.role as Role);
    if (leaving && body.username.toLowerCase() === user.username.toLowerCase()) return apiJson({ left: true });
    return apiJson(notebook(id, user.username));
  });
}
