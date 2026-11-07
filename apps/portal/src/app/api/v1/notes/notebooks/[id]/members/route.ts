import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, DriveProblem, setMember, spaceFor, type Role } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";
import { notes } from "@/lib/notes";

type Context = { params: Promise<{ id: string }> };

function notebook(id: string, username: string) {
  const space = spaceFor(db(), id, username);
  if (space.purpose !== "notes") throw new DriveProblem("That notebook doesn't exist, or you're not in it.", 404);
  return { id: space.id, name: space.name, role: space.role, members: space.memberList };
}

/** Who is in a notebook. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(() => apiJson(notebook(id, user.username)));
}

/** Adds, changes or (role null) removes someone: `{ username, role }`. Anyone may leave. */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(async () => {
    notebook(id, user.username);
    const body = read.body as { username?: unknown; role?: unknown };
    if (typeof body.username !== "string") throw new DriveProblem("Say whose access to change.");
    const leaving = body.role === null;
    if (!leaving) await knownMembers([{ username: body.username, role: body.role }]);
    setMember(db(), id, user.username, body.username, leaving ? null : body.role as Role);
    if (leaving && body.username.toLowerCase() === user.username.toLowerCase()) return apiJson({ left: true });
    return apiJson(notebook(id, user.username));
  });
}
