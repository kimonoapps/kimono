import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { people, type Person } from "@/lib/friends";

/*
 * 人 People on this Kimono, as the apps may see them. No one gets the whole
 * list: someone is found by typing at least three letters of their name, or
 * looked up by a username the app already has (an owner, a member, a friend).
 */

export const FIND_AT_LEAST = 3;
const FIND_AT_MOST = 8;
const LOOK_UP_AT_MOST = 100;

/** People whose name or username has what was typed, the closest first; none under three letters. */
export async function searchPeople(viewer: string, typed: string, skip: Set<string> = new Set()): Promise<Person[]> {
  const q = typed.trim().toLowerCase().replace(/^@/, "");
  if (q.length < FIND_AT_LEAST) return [];
  const me = viewer.toLowerCase();
  const rank = (p: Person) => {
    const words = [p.username, ...(p.name ?? "").toLowerCase().split(/\s+/)];
    return words.some((w) => w === q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : 2;
  };
  return (await people())
    .filter((p) => p.username !== me && !skip.has(p.username) && (p.username.includes(q) || (p.name ?? "").toLowerCase().includes(q)))
    .sort((a, b) => rank(a) - rank(b) || (a.name || a.username).localeCompare(b.name || b.username))
    .slice(0, FIND_AT_MOST);
}

/** The people behind usernames the app already has; a username no one has is left out. */
export async function peopleNamed(usernames: string[]): Promise<Person[]> {
  const wanted = new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean).slice(0, LOOK_UP_AT_MOST));
  return (await people()).filter((p) => wanted.has(p.username));
}

/**
 * `GET ?q=<three letters or more>` finds people, `?u=a,b` looks up ones already known.
 * Answers `{ people }`; with neither, a 400: there is no list of everyone.
 */
export async function peopleRequest(request: Request): Promise<Response> {
  const user = await apiUser();
  if (!user) return unauthorized();
  const params = new URL(request.url).searchParams;
  const q = params.get("q"), u = params.get("u");
  if (q !== null) return apiJson({ people: await searchPeople(user.username, q) });
  if (u !== null) return apiJson({ people: await peopleNamed(u.split(",")) });
  return apiError(400, `Search by name: ${FIND_AT_LEAST} letters at least.`);
}
