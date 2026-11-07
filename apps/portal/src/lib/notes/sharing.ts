import "server-only";

import { portalOrigin } from "../account";
import { apiJson, apiUser, crossSite, readJson, unauthorized } from "../api-v1";
import { listAccounts } from "../directory";
import { db, DriveProblem, linkFile, nodeFor, publicLinksAllowed, roleOn, sharesOn, shareNode, unlinkFile } from "../drive";
import { notebookFor, noteFor } from "./model";
import { notes } from "./index";

/*
 * Sharing a notebook or a note: the people it's shared with beyond its space
 * (Drive's shares), and its public link. The same handlers serve
 * /notes/notebooks/:id/… and /notes/:id/…; [check] says which it must be.
 */
type Check = (id: string, username: string) => unknown;
export const isNotebook: Check = (id, username) => notebookFor(db(), id, username);
export const isNote: Check = (id, username) => noteFor(db(), id, username);

/** Where a public link opens: Notes' own read-only page. */
export const publicUrl = (token: string) => `${portalOrigin()}/n/${token}`;

function view(id: string, username: string) {
  const info = sharesOn(db(), id, username);
  const node = nodeFor(db(), id, username);
  return { ...info, role: roleOn(db(), id, username), link: node.link ? publicUrl(node.link) : null };
}

/** Who it's shared with, who has it through its notebook, who sees it in its space, and its public link. */
export async function getSharing(id: string, check: Check) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return notes(() => { check(id, user.username); return apiJson(view(id, user.username)); });
}

/** Shares it with someone, changes what they may do, or (role null) takes them off: `{ username, role }`. */
export async function putSharing(request: Request, id: string, check: Check) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return notes(async () => {
    check(id, user.username);
    const body = read.body as { username?: unknown; role?: unknown };
    if (typeof body.username !== "string") throw new DriveProblem("Say who to share it with.");
    const leaving = body.role === null;
    if (!leaving && body.role !== "editor" && body.role !== "viewer") throw new DriveProblem("They can edit it or view it.");
    if (!leaving) {
      const known = new Set((await listAccounts()).map((a) => a.username.toLowerCase()));
      if (!known.has(body.username.toLowerCase())) throw new DriveProblem(`There's no Kimono account called ${body.username}.`);
    }
    shareNode(db(), id, user.username, body.username, leaving ? null : body.role as "editor" | "viewer");
    if (leaving && body.username.toLowerCase() === user.username.toLowerCase()) return apiJson({ left: true });
    return apiJson(view(id, user.username));
  });
}

/** Turns on its public link (read-only, no sign-in) and returns it. */
export async function postLink(request: Request, id: string, check: Check) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return notes(async () => {
    check(id, user.username);
    await publicLinksAllowed();
    return apiJson({ link: publicUrl(linkFile(db(), id, user.username)) });
  });
}

/** Turns its public link off; the address stops working at once. */
export async function deleteLink(request: Request, id: string, check: Check) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return notes(() => { check(id, user.username); unlinkFile(db(), id, user.username); return apiJson({ link: null }); });
}
