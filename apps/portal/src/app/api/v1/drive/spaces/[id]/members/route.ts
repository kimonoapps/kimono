import { withMark } from "@/lib/drive/marks";
import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, drive, DriveProblem, setMember, spaceFor, type Role } from "@/lib/drive";
import { knownMembers } from "@/lib/drive/members";

type Context = { params: Promise<{ id: string }> };

/** Adds, changes or (role null) removes a member: `{ username, role }`. Anyone may remove themselves. */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(async () => {
    const body = read.body as { username?: unknown; role?: unknown };
    if (typeof body.username !== "string") throw new DriveProblem("Say whose access to change.");
    const leaving = body.role === null;
    if (!leaving) await knownMembers([{ username: body.username, role: body.role }]);
    setMember(db(), id, user.username, body.username, leaving ? null : body.role as Role);
    if (leaving && body.username.toLowerCase() === user.username.toLowerCase()) return apiJson({ left: true });
    return apiJson(withMark(spaceFor(db(), id, user.username)));
  });
}
