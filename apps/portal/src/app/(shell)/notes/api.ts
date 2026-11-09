/*
 * Notes' API as the web page uses it: the same /api/v1/notes endpoints the
 * phone calls, signed in by the browser's own session.
 */

export type Role = "owner" | "editor" | "viewer";
/** A notebook is a folder in a Drive space; whoever is in the space shares it. `isSpace`: shared on its own, the space is just it. */
export type Notebook = {
  id: string; name: string; createdBy: string; createdAt: number; updatedAt: number; role: Role; isSpace: boolean;
  /** Shared with this person from a space they aren't in: it stands on its own, under Shared with you. */
  sharedWithYou: boolean;
  space: { id: string; name: string; crest: string; color: string; members: number };
};
export type Section = { id: string; notebookId: string; parentId: string; name: string; updatedAt: number };
/** `notebookId` is null for a note shared with you on its own, outside any notebook of yours. */
export type Note = { id: string; notebookId: string | null; parentId: string; title: string; createdBy: string; createdAt: number; updatedAt: number; version: number; excerpt?: string };
export type Library = { notebooks: Notebook[]; sections: Section[]; notes: Note[] };
export type Person = { username: string; name: string; picture: string | null };
export type Share = { username: string; role: "editor" | "viewer"; addedBy: string; addedAt: number };
/** Who has a notebook or note beyond its space, who has it through its notebook, how many see it in its space, and its public link. */
export type Sharing = {
  shares: Share[]; inherited: (Share & { via: { id: string; name: string } })[];
  space: { id: string; name: string; members: number }; role: Role | null; link: string | null;
};
/** What can be shared: a notebook, or a single note. */
export type Shareable = { kind: "notebook" | "note"; id: string; name: string };
const base = (thing: Pick<Shareable, "kind" | "id">) => thing.kind === "notebook" ? `/notebooks/${thing.id}` : `/${thing.id}`;

export class NotesProblem extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path.startsWith("/api/") ? path : `/api/v1/notes${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      credentials: "same-origin",
    });
  } catch {
    throw new NotesProblem("That didn't work.");
  }
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
  if (!response.ok) throw new NotesProblem((body as { error?: string }).error || "That didn't work.", response.status);
  return body as T;
}

const json = (method: string, body?: unknown, keepalive = false): RequestInit => ({ method, keepalive, body: body === undefined ? undefined : JSON.stringify(body) });

export const notes = {
  library: () => call<Library>(""),
  open: (id: string) => call<{ note: Note; text: string }>(`/${id}`),
  create: (parent: string | null, title?: string, text?: string) => call<Note>("", json("POST", { parent: parent ?? undefined, title, text })),
  /** `keepalive` lets a save started as the page closes still land. */
  save: (id: string, text: string, version: number, keepalive = false) => call<{ note: Note; conflict: boolean }>(`/${id}`, json("PUT", { text, version }, keepalive)),
  retitle: (id: string, title: string) => call<Note>(`/${id}`, json("PATCH", { title })),
  move: (id: string, parent: string) => call<Note>(`/${id}`, json("PATCH", { parent })),
  remove: (id: string) => call<unknown>(`/${id}`, { method: "DELETE" }),
  restore: (id: string) => call<unknown>(`/${id}/restore`, { method: "POST" }),
  createSection: (name: string, parent: string) => call<Section>("/sections", json("POST", { name, parent })),
  renameSection: (id: string, name: string) => call<Section>(`/sections/${id}`, json("PATCH", { name })),
  removeSection: (id: string) => call<unknown>(`/sections/${id}`, { method: "DELETE" }),
  /** A new notebook, in the space named or the person's own. */
  createNotebook: (name: string, space?: string) => call<Notebook>("/notebooks", json("POST", { name, space })),
  /** The spaces a notebook can go in: Drive's list (only while Drive is on; Notes falls back to the person's own). */
  /* Spaces a notebook can go in besides your Notes space, which is "your own". */
  spaces: () => call<{ spaces: { id: string; name: string; role: Role; code?: unknown; purpose?: string | null }[] }>("/api/v1/drive/spaces")
    .then((r) => r.spaces.filter((s) => s.role !== "viewer" && !s.code && !(s.purpose === "notes" && s.role === "owner"))),
  renameNotebook: (id: string, name: string) => call<Notebook>(`/notebooks/${id}`, json("PATCH", { name })),
  removeNotebook: (id: string) => call<unknown>(`/notebooks/${id}`, { method: "DELETE" }),
  sharing: (thing: Pick<Shareable, "kind" | "id">) => call<Sharing>(`${base(thing)}/members`),
  /** Shares it with someone, changes what they may do, or (null) takes them off; yourself with null is leaving. */
  share: (thing: Pick<Shareable, "kind" | "id">, username: string, role: "editor" | "viewer" | null) => call<Sharing | { left: true }>(`${base(thing)}/members`, json("PUT", { username, role })),
  link: (thing: Pick<Shareable, "kind" | "id">, on: boolean) => call<{ link: string | null }>(`${base(thing)}/link`, on ? { method: "POST" } : { method: "DELETE" }).then((r) => r.link),
  people: () => call<{ people: Person[] }>("/people").then((r) => r.people),
};

/** One word for when, and only when it says something: "now", "5m", "2h", "Tue", "3 Oct". */
export function when(at: number, now = Date.now()) {
  const ago = Math.max(0, now - at);
  if (ago < 60_000) return "now";
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m`;
  const date = new Date(at), today = new Date(now);
  if (ago < 86_400_000 && date.getDate() === today.getDate()) return `${Math.floor(ago / 3_600_000)}h`;
  if (ago < 6 * 86_400_000) return date.toLocaleDateString("en-GB", { weekday: "short" });
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}
