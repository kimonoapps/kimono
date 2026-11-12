import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/*
 * Artifacts (docs/kimono-ai.md, "Artifacts"): pages Kimono AI makes, written
 * as files in the chat's sandbox at /workspace/artifacts/<name>.html. Kimono
 * keeps the latest of each here, so a chat shows them whether or not its
 * sandbox is awake, and streams them to the page while they're being written.
 */

/** `media` is where the files it plays or shows (media/<name> in its page) are served: /ai/media/<key>/. */
export type Artifact = { name: string; title: string; content: string; version: number; updatedAt: number; media: string };

/*
 * An artifact's media: sounds, videos and pictures it names as media/<file>,
 * from the sandbox's /workspace/media/ (kimono-say, kimono-fetch, or made
 * there). Kimono copies the ones it names out of the sandbox when it keeps the
 * artifact, and serves them at an address with a key of its own, the only
 * place the artifact's frame may load media from. Only files the artifact's
 * current page names are served.
 */
const mediaPattern = /(?<![\w/.-])media\/([A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|mp4|m4v|mov|png|jpe?g|webp|gif|avif))\b/gi;
export const maxMediaBytes = 50 * 1024 * 1024;

/** The media files an artifact's page names, each once. */
export function mediaNames(content: string): string[] {
  const names = new Set<string>();
  for (const found of content.matchAll(mediaPattern)) {
    names.add(found[1]);
    if (names.size >= 60) break;
  }
  return [...names];
}

export const mediaBase = (key: string) => `/ai/media/${key}/`;
const newMediaKey = () => randomBytes(16).toString("hex");

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
  const row = db.prepare(`INSERT INTO artifacts (workspace_id, name, title, content, version, updated_at, media_key) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (workspace_id, name) DO UPDATE SET title = excluded.title, content = excluded.content, version = artifacts.version + 1, updated_at = excluded.updated_at,
      media_key = COALESCE(artifacts.media_key, excluded.media_key)
    RETURNING version, media_key`).get(workspaceId, name, title, content, now, newMediaKey()) as { version: number; media_key: string };
  return { name, title, content, version: row.version, updatedAt: now, media: mediaBase(row.media_key) };
}

/** The artifact a media key belongs to: its chat, and its page (whose media/ names are all it may serve). */
export function artifactByMediaKey(db: DatabaseSync, key: string): { workspaceId: string; name: string; content: string } | null {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const row = db.prepare("SELECT workspace_id, name, content FROM artifacts WHERE media_key = ?").get(key) as { workspace_id: string; name: string; content: string } | undefined;
  return row ? { workspaceId: row.workspace_id, name: row.name, content: row.content } : null;
}

export function artifactOf(db: DatabaseSync, workspaceId: string, name: string): Artifact | null {
  const row = db.prepare("SELECT name, title, content, version, updated_at, media_key FROM artifacts WHERE workspace_id = ? AND name = ?").get(workspaceId, name) as { name: string; title: string; content: string; version: number; updated_at: number; media_key: string | null } | undefined;
  if (!row) return null;
  /* Kept before artifacts had media: it gets its key now. */
  let key = row.media_key;
  if (!key) {
    key = newMediaKey();
    db.prepare("UPDATE artifacts SET media_key = ? WHERE workspace_id = ? AND name = ? AND media_key IS NULL").run(key, workspaceId, name);
    key = (db.prepare("SELECT media_key FROM artifacts WHERE workspace_id = ? AND name = ?").get(workspaceId, name) as { media_key: string }).media_key;
  }
  return { name: row.name, title: row.title, content: row.content, version: row.version, updatedAt: row.updated_at, media: mediaBase(key) };
}

export function artifactsOf(db: DatabaseSync, workspaceId: string): Omit<Artifact, "content" | "media">[] {
  return (db.prepare("SELECT name, title, version, updated_at FROM artifacts WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as { name: string; title: string; version: number; updated_at: number }[])
    .map((r) => ({ name: r.name, title: r.title, version: r.version, updatedAt: r.updated_at }));
}

/*
 * Following Claude Code's partial messages (stream_event lines): the text it
 * is writing, and an artifact while its Write call is still arriving. Nothing
 * here is stored; it goes to whoever is watching, a few times a second.
 */
export type Phase = "working" | "thinking" | "writing" | "tools" | "artifact";
export type ToolHint = { tool?: "web" | "command" | "files" | "helper"; app?: string; space?: string; doing?: string };
export type Draft =
  | { kind: "draft"; text: string }
  | { kind: "artifact-draft"; id: string; name: string; content: string }
  | ({ kind: "phase"; phase: Phase } & ToolHint);

type Block = { type: "text" | "tool"; id?: string; name?: string; json: string; text: string; sent: number; artifact?: string | null };

/*
 * Also what it is doing, from the blocks it starts: thinking, writing, a tool
 * (with the app or Drive space once its input is in), or an artifact. Only a
 * change is sent, at most every [settle] ms, the last one winning.
 */
export class Drafts {
  private blocks = new Map<number, Block>();
  private send: (draft: Draft) => void;
  private every: number;
  private describe?: (name: string, input: Record<string, unknown>) => ToolHint;
  private phaseSent = { key: "", at: 0 };
  private phaseNext: Extract<Draft, { kind: "phase" }> | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private settle = 300;
  constructor(send: (draft: Draft) => void, options: { every?: number; describe?: (name: string, input: Record<string, unknown>) => ToolHint } = {}) {
    this.send = send; this.every = options.every ?? 120; this.describe = options.describe;
  }

  take(line: Record<string, unknown>) {
    const event = line.event as Record<string, unknown> | undefined;
    if (line.type !== "stream_event" || !event) return;
    const index = typeof event.index === "number" ? event.index : -1;
    switch (event.type) {
      /* A new message: whatever tool it called has finished. */
      /* Only the first says "working": after a tool, what it shows stays until the next thing it does, rather than flickering. */
      case "message_start": this.blocks.clear(); if (!this.phaseSent.key && !this.phaseNext) this.phase({ kind: "phase", phase: "working" }); return;
      case "content_block_start": {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === "thinking" || block?.type === "redacted_thinking") this.phase({ kind: "phase", phase: "thinking" });
        else if (block?.type === "text") { this.blocks.set(index, { type: "text", json: "", text: "", sent: 0 }); this.phase({ kind: "phase", phase: "writing" }); }
        else if (block?.type === "tool_use") {
          const name = String(block.name ?? "");
          this.blocks.set(index, { type: "tool", id: String(block.id ?? ""), name, json: "", text: "", sent: 0 });
          /* Said once its input is in (content_block_stop), unless its name alone says what it is. */
          const hint = this.hint(name, {});
          if (Object.keys(hint).length) this.phase({ kind: "phase", phase: "tools", ...hint });
        }
        return;
      }
      case "content_block_delta": {
        const block = this.blocks.get(index), delta = event.delta as Record<string, unknown> | undefined;
        if (!block || !delta) return;
        if (block.type === "text" && delta.type === "text_delta" && typeof delta.text === "string") { block.text += delta.text; this.flush(block, false); }
        if (block.type === "tool" && delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          block.json += delta.partial_json;
          if (block.name === "Write") this.flush(block, false);
          /* A command that writes into artifacts/ (a heredoc, say) is making one too. */
          else if (block.name === "Bash" && block.artifact === undefined && block.json.length < 4000 && /artifacts\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.html/.test(partialString(block.json, "command") ?? "") && /(?:>|\btee\b|\bcp\b|\bmv\b)[^\n]{0,80}artifacts\//.test(partialString(block.json, "command") ?? "")) {
            block.artifact = "command";
            this.phase({ kind: "phase", phase: "artifact" });
          }
          /* Changing an artifact is making one too, once its path is in. */
          else if ((block.name === "Edit" || block.name === "MultiEdit") && block.artifact === undefined) {
            const path = partialString(block.json, "file_path");
            if (path !== undefined && /"file_path"\s*:\s*"(?:[^"\\]|\\.)*"/.test(block.json)) {
              block.artifact = artifactName(path);
              if (block.artifact) this.phase({ kind: "phase", phase: "artifact" });
            }
          }
        }
        return;
      }
      case "content_block_stop": {
        const block = this.blocks.get(index);
        if (!block) return;
        if (block.name === "Write") this.flush(block, true);
        /* Its input is in: say which app or space it is using, unless it is an artifact. */
        if (block.type === "tool" && !block.artifact) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(block.json || "{}"); } catch { /* cut short */ }
          this.phase({ kind: "phase", phase: "tools", ...this.hint(block.name ?? "", input) });
        }
        if (block.type === "text") this.flush(block, true);
        this.blocks.delete(index);
        return;
      }
    }
  }

  /** Sends nothing more, for a turn that ended. */
  close() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null; this.phaseNext = null;
  }

  private hint(name: string, input: Record<string, unknown>): ToolHint {
    try { return this.describe?.(name, input) ?? {}; } catch { return {}; }
  }

  private phase(next: Extract<Draft, { kind: "phase" }>) {
    this.phaseNext = next;
    if (this.phaseTimer) return;
    const wait = this.settle - (Date.now() - this.phaseSent.at);
    if (wait <= 0) this.sendPhase();
    else this.phaseTimer = setTimeout(() => { this.phaseTimer = null; this.sendPhase(); }, wait);
  }

  private sendPhase() {
    const next = this.phaseNext;
    this.phaseNext = null;
    if (!next) return;
    const key = JSON.stringify(next);
    if (key === this.phaseSent.key) return;
    this.phaseSent = { key, at: Date.now() };
    this.send(next);
  }

  private flush(block: Block, last: boolean) {
    const now = Date.now();
    if (!last && now - block.sent < this.every) return;
    block.sent = now;
    if (block.type === "text") { if (block.text.trim() && !last) this.send({ kind: "draft", text: block.text }); return; }
    if (block.artifact === undefined || block.artifact === null) {
      const path = partialString(block.json, "file_path");
      /* the path is complete once its closing quote is in */
      if (path !== undefined && new RegExp(`"file_path"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`).test(block.json)) {
        block.artifact = artifactName(path);
        if (block.artifact) this.phase({ kind: "phase", phase: "artifact" });
      } else return;
    }
    if (!block.artifact) return;
    const content = partialString(block.json, "content");
    if (content !== undefined) this.send({ kind: "artifact-draft", id: block.id ?? "", name: block.artifact, content });
  }
}
