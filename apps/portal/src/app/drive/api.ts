/*
 * Drive's API as the web page uses it: the same /api/v1/drive endpoints the
 * phone apps call, signed in by the browser's own session.
 */

export type Role = "owner" | "editor" | "viewer";

export type Space = {
  id: string; name: string; crest: string; color: string; mark?: string; rootId: string;
  role: Role; members: number; createdBy: string;
};
export type Member = { username: string; role: Role };
export type SpaceDetail = Space & { memberList: Member[] };
export type DriveNode = {
  id: string; spaceId: string; parentId: string | null; kind: "folder" | "file"; name: string;
  size: number; mime: string | null; createdBy: string; updatedAt: number; trashedAt: number | null;
  link: string | null; guest?: string | null;
};
export type Folder = { folder: DriveNode; path: DriveNode[]; children: DriveNode[] };
export type Person = { username: string; name: string; picture: string | null };
export type Crests = {
  crests: { id: string; jp: string; name: string }[];
  colors: { id: string; jp: string; name: string; hex: string }[];
  marks: Record<string, Record<string, string>>;
};

export class DriveProblem extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/drive${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      credentials: "same-origin",
    });
  } catch {
    throw new DriveProblem("Kimono isn't answering. Check your connection and try again.");
  }
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
  if (!response.ok) throw new DriveProblem((body as { error?: string }).error || "That didn't work. Try again.", response.status);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const drive = {
  spaces: () => call<{ spaces: Space[] }>("/spaces").then((r) => r.spaces),
  space: (id: string) => call<SpaceDetail>(`/spaces/${id}`),
  createSpace: (name: string, crest: string, color: string, members: Member[]) => call<Space>("/spaces", json("POST", { name, crest, color, members })),
  editSpace: (id: string, change: { name?: string; crest?: string; color?: string }) => call<SpaceDetail>(`/spaces/${id}`, json("PATCH", change)),
  setMember: (id: string, username: string, role: Role | null) => call<SpaceDetail | { left: true }>(`/spaces/${id}/members`, json("PUT", { username, role })),
  folder: (id: string) => call<Folder>(`/nodes/${id}`),
  createFolder: (parent: string, name: string) => call<DriveNode>(`/nodes/${parent}/folders`, json("POST", { name })),
  rename: (id: string, name: string) => call<DriveNode>(`/nodes/${id}`, json("PATCH", { name })),
  move: (id: string, parent: string) => call<DriveNode>(`/nodes/${id}`, json("PATCH", { parent })),
  trash: (id: string) => call<unknown>(`/nodes/${id}`, { method: "DELETE" }),
  restore: (id: string) => call<DriveNode>(`/nodes/${id}/restore`, { method: "POST" }),
  link: (id: string) => call<{ url: string }>(`/nodes/${id}/link`, { method: "POST" }).then((r) => r.url),
  unlink: (id: string) => call<unknown>(`/nodes/${id}/link`, { method: "DELETE" }),
  trashed: () => call<{ items: DriveNode[] }>("/trash").then((r) => r.items),
  recent: () => call<{ items: DriveNode[] }>("/recent").then((r) => r.items),
  search: (q: string) => call<{ items: DriveNode[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.items),
  people: () => call<{ people: Person[] }>("/people").then((r) => r.people),
  crests: () => call<Crests>("/crests"),
};

export const contentUrl = (node: DriveNode) => `/api/v1/drive/nodes/${node.id}/content`;

/** A public link's address, from the token the API lists with a file. */
export const linkUrl = (node: DriveNode) => node.link ? `${window.location.origin}/d/${node.link}/${encodeURIComponent(node.name)}` : null;

/* ── uploads: tus in 8 MB pieces, picking up after a dropped connection ── */

const piece = 8 * 1024 * 1024;
const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export type UploadProgress = (sent: number) => void;

/** Uploads [file] into [folderId]; returns the new file's id. */
export async function upload(file: File, folderId: string, progress: UploadProgress, signal: AbortSignal): Promise<string> {
  const tus = { "Tus-Resumable": "1.0.0" };
  const started = await fetch("/api/v1/drive/uploads", {
    method: "POST", signal, credentials: "same-origin",
    headers: { ...tus, "Upload-Length": String(file.size), "Upload-Metadata": `filename ${b64(file.name)},folder ${b64(folderId)}` },
  }).catch(() => { throw new DriveProblem("Kimono isn't answering. Check your connection and try again."); });
  if (started.status !== 201) throw new DriveProblem(await problemOf(started, "That file couldn't be uploaded."), started.status);
  const location = started.headers.get("Location");
  if (!location) throw new DriveProblem("That file couldn't be uploaded.");
  let offset = 0;
  let failures = 0;
  progress(0);
  while (true) {
    const body = file.slice(offset, Math.min(file.size, offset + piece));
    let response: Response | null = null;
    try {
      response = await fetch(location, {
        method: "PATCH", signal, credentials: "same-origin", body,
        headers: { ...tus, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
      });
    } catch (error) {
      if (signal.aborted) throw error;
    }
    if (response?.ok) {
      failures = 0;
      offset = Number(response.headers.get("Upload-Offset") ?? offset + body.size);
      progress(offset);
      const made = response.headers.get("Kimono-File");
      if (made) return made;
      if (offset >= file.size) throw new DriveProblem("That file couldn't be uploaded.");
      continue;
    }
    if (response && response.status !== 409) throw new DriveProblem(await problemOf(response, "That file couldn't be uploaded."), response.status);
    /* Dropped, or out of step: wait a little, ask the server how far it got, carry on. */
    failures += 1;
    if (failures > 8) throw new DriveProblem("The connection keeps dropping. Try again later.");
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** failures)));
    const head = await fetch(location, { method: "HEAD", signal, credentials: "same-origin", headers: tus }).catch(() => null);
    const at = Number(head?.headers.get("Upload-Offset"));
    if (head?.ok && Number.isFinite(at)) offset = at;
  }
}

async function problemOf(response: Response, fallback: string) {
  try { return ((await response.json()) as { error?: string }).error || fallback; } catch { return fallback; }
}

/** "3.1 MB", "15 KB". */
export function readableSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value >= 100 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit]}`;
}

/** "Today 21:14", "Yesterday", "3 Oct". */
export function when(at: number) {
  const date = new Date(at);
  const today = new Date();
  const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  if (days === 0) return `Today ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

export function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
}

export function kindOf(node: DriveNode): "folder" | "image" | "video" | "pdf" | "audio" | "file" {
  if (node.kind === "folder") return "folder";
  const mime = node.mime || "";
  const ext = extension(node.name).toLowerCase();
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"].includes(ext)) return "image";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm", "m4v", "mkv"].includes(ext)) return "video";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("audio/") || ["mp3", "ogg", "wav", "m4a", "flac"].includes(ext)) return "audio";
  return "file";
}
