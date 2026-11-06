import type { DatabaseSync } from "node:sqlite";

/*
 * Artifacts (docs/kimono-ai.md, "Artifacts"): pages Kimono AI makes, written
 * as files in the chat's sandbox at /workspace/artifacts/<name>.html. Kimono
 * keeps the latest of each here, so a chat shows them whether or not its
 * sandbox is awake, and streams them to the page while they're being written.
 */

export type Artifact = { name: string; title: string; content: string; version: number; updatedAt: number };

/** The artifact a path names, or null: artifacts/<name>.html, under /workspace or not. */
export function artifactName(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const found = /^(?:\/workspace\/)?artifacts\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.html$/.exec(path.trim());
  return found ? found[1].toLowerCase() : null;
}

/** `kimono-show <name>` in a command: show that artifact again, here. */
export function shownName(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const found = /(?:^|[;&|]\s*)kimono-show\s+["']?([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\.html)?["']?\s*$/m.exec(command.trim());
  return found ? found[1].toLowerCase() : null;
}

/** An artifact's title: its <title>, else its name in words. */
export function titleOf(content: string, name: string): string {
  const found = /<title>([^<]{1,120})<\/title>/i.exec(content);
  return (found?.[1].trim() || name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase())).slice(0, 120);
}

/**
 * A string field from JSON that is still arriving: everything decoded so far,
 * whether or not its closing quote has come. Undefined until its key has.
 */
export function partialString(json: string, key: string): string | undefined {
  const found = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!found) return undefined;
  let out = "";
  for (let i = found.index + found[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') return out;
    if (c !== "\\") { out += c; continue; }
    const next = json[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue;
    }
    out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[next] ?? next;
    i++;
  }
  return out;
}

export type Edit = { old_string: string; new_string: string; replace_all?: boolean };

/** Claude Code's Edit, done again on Kimono's copy. Null when an edit doesn't apply (then the file is read instead). */
export function applyEdits(content: string, edits: Edit[]): string | null {
  let out = content;
  for (const edit of edits) {
    if (typeof edit?.old_string !== "string" || typeof edit.new_string !== "string") return null;
    if (!edit.old_string) return null;
    const at = out.indexOf(edit.old_string);
    if (at < 0) return null;
    out = edit.replace_all ? out.split(edit.old_string).join(edit.new_string) : out.slice(0, at) + edit.new_string + out.slice(at + edit.old_string.length);
  }
  return out;
}

/** What an Edit or MultiEdit call asks for, as a list of edits. */
export function editsOf(name: string, input: Record<string, unknown>): Edit[] {
  if (name === "MultiEdit" && Array.isArray(input.edits)) return input.edits as Edit[];
  return [input as unknown as Edit];
}

export const maxArtifactBytes = 2 * 1024 * 1024;

export function saveArtifact(db: DatabaseSync, workspaceId: string, name: string, content: string, now = Date.now()): Artifact {
  if (content.length > maxArtifactBytes) content = content.slice(0, maxArtifactBytes);
  const title = titleOf(content, name);
  const row = db.prepare(`INSERT INTO artifacts (workspace_id, name, title, content, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT (workspace_id, name) DO UPDATE SET title = excluded.title, content = excluded.content, version = artifacts.version + 1, updated_at = excluded.updated_at
    RETURNING version`).get(workspaceId, name, title, content, now) as { version: number };
  return { name, title, content, version: row.version, updatedAt: now };
}

export function artifactOf(db: DatabaseSync, workspaceId: string, name: string): Artifact | null {
  const row = db.prepare("SELECT name, title, content, version, updated_at FROM artifacts WHERE workspace_id = ? AND name = ?").get(workspaceId, name) as { name: string; title: string; content: string; version: number; updated_at: number } | undefined;
  return row ? { name: row.name, title: row.title, content: row.content, version: row.version, updatedAt: row.updated_at } : null;
}

export function artifactsOf(db: DatabaseSync, workspaceId: string): Omit<Artifact, "content">[] {
  return (db.prepare("SELECT name, title, version, updated_at FROM artifacts WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as { name: string; title: string; version: number; updated_at: number }[])
    .map((r) => ({ name: r.name, title: r.title, version: r.version, updatedAt: r.updated_at }));
}

/*
 * Following Claude Code's partial messages (stream_event lines): the text it
 * is writing, and an artifact while its Write call is still arriving. Nothing
 * here is stored; it goes to whoever is watching, a few times a second.
 */
export type Draft =
  | { kind: "draft"; text: string }
  | { kind: "artifact-draft"; id: string; name: string; content: string };

export class Drafts {
  private blocks = new Map<number, { type: "text" | "tool"; id?: string; name?: string; json: string; text: string; sent: number; artifact?: string | null }>();
  private send: (draft: Draft) => void;
  private every: number;
  constructor(send: (draft: Draft) => void, every = 120) { this.send = send; this.every = every; }

  take(line: Record<string, unknown>) {
    const event = line.event as Record<string, unknown> | undefined;
    if (line.type !== "stream_event" || !event) return;
    const index = typeof event.index === "number" ? event.index : -1;
    switch (event.type) {
      case "message_start": this.blocks.clear(); return;
      case "content_block_start": {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === "text") this.blocks.set(index, { type: "text", json: "", text: "", sent: 0 });
        else if (block?.type === "tool_use" && (block.name === "Write")) this.blocks.set(index, { type: "tool", id: String(block.id ?? ""), name: String(block.name), json: "", text: "", sent: 0 });
        return;
      }
      case "content_block_delta": {
        const block = this.blocks.get(index), delta = event.delta as Record<string, unknown> | undefined;
        if (!block || !delta) return;
        if (block.type === "text" && delta.type === "text_delta" && typeof delta.text === "string") { block.text += delta.text; this.flush(block, false); }
        if (block.type === "tool" && delta.type === "input_json_delta" && typeof delta.partial_json === "string") { block.json += delta.partial_json; this.flush(block, false); }
        return;
      }
      case "content_block_stop": {
        const block = this.blocks.get(index);
        if (block) { this.flush(block, true); this.blocks.delete(index); }
        return;
      }
    }
  }

  private flush(block: { type: "text" | "tool"; id?: string; json: string; text: string; sent: number; artifact?: string | null }, last: boolean) {
    const now = Date.now();
    if (!last && now - block.sent < this.every) return;
    block.sent = now;
    if (block.type === "text") { if (block.text.trim() && !last) this.send({ kind: "draft", text: block.text }); return; }
    if (block.artifact === undefined || block.artifact === null) {
      const path = partialString(block.json, "file_path");
      /* the path is complete once its closing quote is in */
      if (path !== undefined && new RegExp(`"file_path"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`).test(block.json)) block.artifact = artifactName(path);
      else return;
    }
    if (!block.artifact) return;
    const content = partialString(block.json, "content");
    if (content !== undefined) this.send({ kind: "artifact-draft", id: block.id ?? "", name: block.artifact, content });
  }
}
