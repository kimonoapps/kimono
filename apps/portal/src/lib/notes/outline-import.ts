/**
 * Brings what people wrote in Outline into Kimono Notes, once.
 *
 * `kimono server import-outline` reads the database Outline left behind and
 * writes it as JSON for the Portal (see ./outline-import-run.ts). Here that
 * becomes notebooks: each collection is a notebook in its creator's own space,
 * shared with whoever could see it in Outline; a document with documents
 * under it is a note and, beside it, a section holding them; drafts, which
 * only their writer saw, go to that person's own "Drafts" notebook; archived
 * documents to an "Archived" section. Deleted documents and templates stay
 * behind. People are matched to Kimono accounts by email, then by name.
 *
 * Every notebook, section and note made is recorded against the Outline id it
 * came from, so running it again only adds what is still missing.
 *
 * Pure logic over the Drive database, tested in scripts/test-outline-import.mjs.
 */
import type { DatabaseSync } from "node:sqlite";
import { addFile, createFolder, DriveProblem, numbered, setPurpose, shareNode, type Role } from "../drive/model";
import { maxNoteBytes, personalSpace } from "./model";

type When = string | number | null | undefined;
export type OutlineUser = { id: string; email?: string | null; name?: string | null; deletedAt?: When };
export type OutlineCollection = { id: string; name?: string | null; permission?: string | null; createdById?: string | null; createdAt?: When; updatedAt?: When; deletedAt?: When; archivedAt?: When };
export type OutlineDocument = {
  id: string; title?: string | null; text?: string | null; content?: unknown; collectionId?: string | null; parentDocumentId?: string | null;
  createdById?: string | null; createdAt?: When; updatedAt?: When; publishedAt?: When; deletedAt?: When; archivedAt?: When; template?: boolean | null;
};
type Permission = { userId?: string | null; groupId?: string | null; collectionId?: string | null; documentId?: string | null; permission?: string | null };
export type OutlineDump = {
  users?: OutlineUser[]; collections?: OutlineCollection[]; documents?: OutlineDocument[];
  /** user_permissions (collection_users before Outline 0.80). */
  userPermissions?: Permission[]; collectionUsers?: Permission[];
  /** group_permissions (collection_groups before), with who is in each group. */
  groupPermissions?: Permission[]; collectionGroups?: Permission[]; groupUsers?: { userId?: string | null; groupId?: string | null }[];
};
export type KimonoAccount = { username: string; email?: string | null; name?: string | null };

export type OutlineImportSummary = {
  notebooks: number; sections: number; notes: number; shares: number;
  /** Already brought over by an earlier run. */
  alreadyImported: number;
  /** Outline people with notes and no Kimono account to give them to. */
  unmatched: { name: string; email: string; documents: number }[];
  skipped: { title: string; reason: string }[];
  /** Notes that link to an Outline attachment, which didn't come across. */
  withAttachments: number;
};

const time = (value: When, fallback: number) => {
  const at = typeof value === "number" ? value : value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : fallback;
};
const lower = (value: string | null | undefined) => (value || "").trim().toLowerCase();
/** A name Drive takes: no slashes or control characters, never blank. */
export function safeName(raw: string | null | undefined, fallback = "Untitled"): string {
  const name = (raw || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim();
  if (!name || name === "." || name === "..") return fallback;
  let cut = name;
  while (Buffer.byteLength(cut) > 240) cut = cut.slice(0, -1);
  return cut;
}
const roleFor = (permission: string | null | undefined): Exclude<Role, "owner"> => permission === "read" ? "viewer" : "editor";

/* ── Outline's text as Markdown ── */

type PMNode = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type?: string; attrs?: Record<string, unknown> }[]; content?: PMNode[] };

/** Outline's own Markdown, tidied: its blank-line backslashes go, and mentions become plain @names. */
export function tidyOutlineMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\\$/gm, "")
    .replace(/@\[([^\]]*)\]\(mention:\/\/[^)]*\)/g, "@$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

function inline(nodes: PMNode[] = []): string {
  return nodes.map((node) => {
    if (node.type === "hard_break" || node.type === "br") return "  \n";
    if (node.type === "mention") return `@${String(node.attrs?.label ?? "")}`;
    if (node.type === "emoji") return String(node.attrs?.["data-name"] ? `:${node.attrs["data-name"]}:` : "");
    if (node.type === "image") return `![${String(node.attrs?.alt ?? "")}](${String(node.attrs?.src ?? "")})`;
    if (node.type === "math_inline") return `$${inline(node.content)}$`;
    if (node.type !== "text") return inline(node.content);
    let text = node.text ?? "";
    const marks = node.marks ?? [];
    const has = (type: string) => marks.some((m) => m.type === type);
    if (has("code_inline")) return `\`${text}\``;
    if (has("strong")) text = `**${text}**`;
    if (has("em")) text = `*${text}*`;
    if (has("strikethrough")) text = `~~${text}~~`;
    const link = marks.find((m) => m.type === "link");
    if (link) text = `[${text}](${String(link.attrs?.href ?? "")})`;
    return text;
  }).join("");
}

function block(node: PMNode, indent = ""): string {
  const kids = node.content ?? [];
  switch (node.type) {
    case "doc": return blocks(kids, indent);
    case "paragraph": return indent + inline(kids);
    case "heading": return `${"#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)))} ${inline(kids)}`;
    case "horizontal_rule": case "hr": return "---";
    case "code_block": case "code_fence": return "```" + String(node.attrs?.language ?? "").replace(/^none$/, "") + "\n" + kids.map((k) => k.text ?? "").join("") + "\n```";
    case "math_block": return "$$\n" + kids.map((k) => k.text ?? "").join("") + "\n$$";
    case "blockquote": case "notice": case "container_notice":
      return blocks(kids).split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
    case "bullet_list": return kids.map((item) => listItem(item, "- ", indent)).join("\n");
    case "ordered_list": return kids.map((item, i) => listItem(item, `${(Number(node.attrs?.order) || 1) + i}. `, indent)).join("\n");
    case "checkbox_list": return kids.map((item) => listItem(item, item.attrs?.checked ? "- [x] " : "- [ ] ", indent)).join("\n");
    case "image": return inline([node]);
    case "attachment": return `[${String(node.attrs?.title ?? "Attachment")}](${String(node.attrs?.href ?? "")})`;
    case "embed": return `<${String(node.attrs?.href ?? "")}>`;
    case "table": return table(node);
    default: return blocks(kids, indent);
  }
}

function blocks(nodes: PMNode[], indent = ""): string {
  return nodes.map((n) => block(n, indent)).filter((s) => s !== "").join("\n\n");
}

function listItem(item: PMNode, marker: string, indent: string): string {
  const [first, ...rest] = item.content ?? [];
  const head = first ? block(first).trimStart() : "";
  const more = rest.map((n) => block(n, indent + "  ")).map((s) => (s.startsWith(indent + "  ") ? s : s.split("\n").map((l) => indent + "  " + l).join("\n")));
  return [indent + marker + head, ...more].join("\n");
}

function table(node: PMNode): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => blocks(cell.content ?? []).replace(/\n+/g, " ").replace(/\|/g, "\\|")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

/** A document's text as Markdown: Outline's own when it kept it, else made from its editor content. */
export function markdownOf(doc: Pick<OutlineDocument, "text" | "content">): string {
  if (typeof doc.text === "string" && doc.text.trim()) return tidyOutlineMarkdown(doc.text);
  let content = doc.content;
  if (typeof content === "string") { try { content = JSON.parse(content); } catch { content = null; } }
  if (!content || typeof content !== "object") return "";
  const text = block(content as PMNode).replace(/\n{3,}/g, "\n\n").trim();
  return text ? tidyOutlineMarkdown(text) : "";
}

/* ── the import ── */

function ledger(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS outline_imports (outline_key TEXT PRIMARY KEY, node_id TEXT NOT NULL, at INTEGER NOT NULL)");
  const live = (key: string) => {
    const row = db.prepare("SELECT o.node_id FROM outline_imports o JOIN nodes n ON n.id = o.node_id WHERE o.outline_key = ? AND n.trashed_at IS NULL").get(key) as { node_id: string } | undefined;
    return row?.node_id ?? null;
  };
  const record = (key: string, nodeId: string, now: number) =>
    db.prepare("INSERT INTO outline_imports (outline_key, node_id, at) VALUES (?, ?, ?) ON CONFLICT (outline_key) DO UPDATE SET node_id = excluded.node_id, at = excluded.at").run(key, nodeId, now);
  return { live, record };
}

/** People in Outline → Kimono usernames: by email, then by a name only one account has. */
export function matchPeople(users: OutlineUser[], accounts: KimonoAccount[]): Map<string, string> {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const a of accounts) {
    const username = a.username.toLowerCase();
    if (lower(a.email)) byEmail.set(lower(a.email), username);
    for (const name of new Set([lower(a.name), username].filter(Boolean))) byName.set(name, byName.has(name) && byName.get(name) !== username ? null : username);
  }
  const out = new Map<string, string>();
  for (const u of users) {
    const found = byEmail.get(lower(u.email)) ?? (lower(u.name) ? byName.get(lower(u.name)) : undefined) ?? (lower(u.email) ? byName.get(lower(u.email).split("@")[0]) : undefined);
    if (found) out.set(u.id, found);
  }
  return out;
}

export function importOutline(
  db: DatabaseSync,
  dump: OutlineDump,
  accounts: KimonoAccount[],
  /** Keeps a note's bytes and names them, as Drive's store does. */
  putBlob: (bytes: Buffer) => string,
  now = Date.now(),
): OutlineImportSummary {
  const summary: OutlineImportSummary = { notebooks: 0, sections: 0, notes: 0, shares: 0, alreadyImported: 0, unmatched: [], skipped: [], withAttachments: 0 };
  const { live, record } = ledger(db);
  const users = dump.users ?? [];
  const people = matchPeople(users, accounts);
  const userById = new Map(users.map((u) => [u.id, u]));
  const docs = (dump.documents ?? []).filter((d) => !d.deletedAt && !d.template);
  /* Drafts stand alone in their writer's Drafts, so nothing published is placed under one, nor one under it. */
  const liveIds = new Set(docs.filter((d) => d.publishedAt).map((d) => d.id));
  const childrenOf = new Map<string, OutlineDocument[]>();
  for (const d of docs) if (d.publishedAt && d.parentDocumentId && liveIds.has(d.parentDocumentId)) childrenOf.set(d.parentDocumentId, [...(childrenOf.get(d.parentDocumentId) ?? []), d]);

  /* Who could open each collection, and how. */
  const groupMembers = new Map<string, string[]>();
  for (const g of dump.groupUsers ?? []) if (g.groupId && g.userId) groupMembers.set(g.groupId, [...(groupMembers.get(g.groupId) ?? []), g.userId]);
  const everyone = users.filter((u) => !u.deletedAt).map((u) => u.id);
  function accessTo(collection: OutlineCollection): Map<string, Exclude<Role, "owner">> {
    const access = new Map<string, Exclude<Role, "owner">>();
    const give = (outlineUser: string, role: Exclude<Role, "owner">) => {
      const username = people.get(outlineUser);
      if (username && access.get(username) !== "editor") access.set(username, role);
    };
    if (collection.permission) for (const id of everyone) give(id, roleFor(collection.permission));
    for (const p of [...(dump.userPermissions ?? []), ...(dump.collectionUsers ?? [])]) if (p.collectionId === collection.id && !p.documentId && p.userId) give(p.userId, roleFor(p.permission));
    for (const p of [...(dump.groupPermissions ?? []), ...(dump.collectionGroups ?? [])]) {
      if (p.collectionId !== collection.id || p.documentId || !p.groupId) continue;
      for (const id of groupMembers.get(p.groupId) ?? []) give(id, roleFor(p.permission));
    }
    return access;
  }

  const unmatched = new Map<string, number>();
  const ownerOf = (d: OutlineDocument) => (d.createdById ? people.get(d.createdById) : undefined) ?? null;

  function folderIn(key: string, parentId: string, owner: string, rawName: string, at: number, notebook = false): string {
    const existing = live(key);
    if (existing) return existing;
    const base = safeName(rawName, notebook ? "Notes" : "Section");
    let folder = null;
    for (let n = 1; !folder; n++) {
      try { folder = createFolder(db, parentId, owner, n === 1 ? base : numbered(base, n), at); }
      catch (error) { if (!(error instanceof DriveProblem && error.status === 409) || n > 50) throw error; }
    }
    if (notebook) setPurpose(db, folder.id, owner, "notebook", null, at);
    record(key, folder.id, now);
    if (notebook) summary.notebooks++; else summary.sections++;
    return folder.id;
  }

  function note(d: OutlineDocument, parentId: string, owner: string) {
    const key = `document:${d.id}`;
    if (live(key)) { summary.alreadyImported++; return; }
    const text = markdownOf(d);
    const bytes = Buffer.from(text, "utf8");
    const title = safeName(d.title);
    if (bytes.length > maxNoteBytes) { summary.skipped.push({ title, reason: "longer than a note may be" }); return; }
    if (/\/api\/attachments\.redirect|\/api\/files\.get|attachments\.outline/i.test(text)) summary.withAttachments++;
    const created = time(d.createdAt, now), updated = time(d.updatedAt, created);
    const node = addFile(db, parentId, owner, { name: `${title}.md`, size: bytes.length, mime: "text/markdown", blob: putBlob(bytes) }, updated);
    db.prepare("UPDATE nodes SET created_at = ? WHERE id = ?").run(created, node.id);
    record(key, node.id, now);
    summary.notes++;
  }

  /* A document, then what is under it in a section of the same name beside it. */
  function place(d: OutlineDocument, parentId: string, owner: string) {
    note(d, parentId, owner);
    const kids = childrenOf.get(d.id) ?? [];
    if (!kids.length) return;
    const section = folderIn(`section:${d.id}`, parentId, owner, d.title || "Untitled", time(d.createdAt, now));
    for (const kid of kids) place(kid, section, owner);
  }

  const owns = (username: string) => personalSpace(db, username, now).rootId;

  /* Drafts: only their writer saw them. */
  for (const d of docs.filter((x) => !x.publishedAt)) {
    const owner = ownerOf(d);
    if (!owner) { unmatched.set(d.createdById ?? "", (unmatched.get(d.createdById ?? "") ?? 0) + 1); continue; }
    note(d, folderIn(`drafts:${owner}`, owns(owner), owner, "Drafts", now, true), owner);
  }

  for (const c of dump.collections ?? []) {
    if (c.deletedAt) continue;
    const inIt = docs.filter((d) => d.collectionId === c.id && d.publishedAt);
    if (!inIt.length) continue;
    const access = accessTo(c);
    const owner = (c.createdById ? people.get(c.createdById) : undefined)
      ?? [...access].find(([, role]) => role === "editor")?.[0]
      ?? inIt.map(ownerOf).find(Boolean) ?? null;
    if (!owner) {
      for (const d of inIt) unmatched.set(d.createdById ?? "", (unmatched.get(d.createdById ?? "") ?? 0) + 1);
      summary.skipped.push({ title: safeName(c.name, "Collection"), reason: "nobody who could see it has a Kimono account" });
      continue;
    }
    const book = folderIn(`collection:${c.id}`, owns(owner), owner, c.name || "Notes", time(c.createdAt, now), true);
    for (const [username, role] of access) {
      if (username === owner) continue;
      try {
        const before = db.prepare("SELECT role FROM shares WHERE node_id = ? AND username = ?").get(book, username) as { role: string } | undefined;
        if (before?.role === role || before?.role === "editor") continue;
        shareNode(db, book, owner, username, role, now);
        summary.shares++;
      } catch (error) { if (!(error instanceof DriveProblem)) throw error; }
    }
    const roots = inIt.filter((d) => !d.parentDocumentId || !liveIds.has(d.parentDocumentId));
    for (const d of roots.filter((x) => !x.archivedAt && !c.archivedAt)) place(d, book, owner);
    const archived = roots.filter((x) => x.archivedAt || c.archivedAt);
    if (archived.length) {
      const shelf = folderIn(`archived:${c.id}`, book, owner, "Archived", now);
      for (const d of archived) place(d, shelf, owner);
    }
  }

  summary.unmatched = [...unmatched].filter(([id]) => id).map(([id, documents]) => {
    const u = userById.get(id);
    return { name: u?.name ?? "", email: u?.email ?? "", documents };
  });
  return summary;
}
