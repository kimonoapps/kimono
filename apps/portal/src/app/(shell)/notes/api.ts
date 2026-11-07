/*
 * Notes' API as the web page uses it: the same /api/v1/notes endpoints the
 * phone calls, signed in by the browser's own session.
 */

export type Role = "owner" | "editor" | "viewer";
/** A notebook is a folder in a Drive space; whoever is in the space shares it. `isSpace`: shared on its own, the space is just it. */
export type Notebook = {
  id: string; name: string; createdBy: string; createdAt: number; updatedAt: number; role: Role; isSpace: boolean;
  space: { id: string; name: string; crest: string; color: string; members: number };
};
export type Section = { id: string; notebookId: string; parentId: string; name: string; updatedAt: number };
export type Note = { id: string; notebookId: string; parentId: string; title: string; createdBy: string; createdAt: number; updatedAt: number; version: number; excerpt?: string };
export type Library = { notebooks: Notebook[]; sections: Section[]; notes: Note[] };
export type Member = { username: string; role: Role };
export type Person = { username: string; name: string; picture: string | null };

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
  createNotebook: (name: string) => call<Notebook>("/notebooks", json("POST", { name })),
  renameNotebook: (id: string, name: string) => call<Notebook>(`/notebooks/${id}`, json("PATCH", { name })),
  removeNotebook: (id: string) => call<unknown>(`/notebooks/${id}`, { method: "DELETE" }),
  /** Shares a notebook on its own: it becomes a space of just it, with you and the people named. */
  share: (id: string, members: Member[]) => call<Notebook>(`/notebooks/${id}/share`, json("POST", { members })),
  members: (notebookId: string) => call<{ id: string; name: string; role: Role; isSpace: boolean; members: Member[] }>(`/notebooks/${notebookId}/members`),
  setMember: (notebookId: string, username: string, role: Role | null) => call<unknown>(`/notebooks/${notebookId}/members`, json("PUT", { username, role })),
  people: () => call<{ people: Person[] }>("/api/v1/drive/people").then((r) => r.people),
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
