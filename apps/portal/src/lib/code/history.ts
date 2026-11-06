import "server-only";

import type { DatabaseSync } from "node:sqlite";
import type { CodeConfig } from "./config";
import type { CodeEvent } from "./events";
import { eventsAfter, workspacesOf, type Workspace } from "./model";
import { sandbox } from "./node";

/*
 * Earlier chats, for Kimono AI to look back on (docs/kimono-ai.md, "Earlier chats").
 *
 * Before each turn, every other chat of the person's goes into the sandbox at
 * .kimono/chats/ (kept out of git and of Drive) as a digest: what was asked and
 * the answer each turn ended with, not the tool calls in between, long parts
 * cut short. An index lists them one line each. Only chats that changed are
 * written again. The kimono-chats helper reads them a little at a time, so
 * looking back costs the conversation a few hundred tokens, not whole chats.
 *
 * A chat shared with anyone, or with a link, gets none of this: someone invited
 * to write in it could otherwise ask about the owner's other chats.
 */

export const historyDir = ".kimono/chats";
const askLimit = 1500;
const answerLimit = 2000;

const cut = (text: string, limit: number) => {
  const flat = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()} […]`;
};
const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const line = (text: string, limit: number) => cut(text.replace(/\s+/g, " "), limit);

/** A chat as Markdown: its title and date, then each turn's question and the answer it ended with. */
export function digestOf(db: DatabaseSync, chat: Workspace): string {
  const out = [`# ${chat.title}`, `${day(chat.createdAt)} to ${day(chat.updatedAt)}${chat.folder ? ` · project ${chat.folder.name}` : ""} · id ${chat.id}`];
  let turn = 0;
  let answer = "";
  let notes: string[] = [];
  const close = () => {
    if (answer) out.push(`Kimono AI: ${cut(answer, answerLimit)}`);
    if (notes.length) out.push(notes.join(" "));
    answer = ""; notes = [];
  };
  for (const { at, event } of eventsAfter(db, chat.id, 0, 100_000) as { at: number; event: CodeEvent }[]) {
    switch (event.kind) {
      case "ask": {
        if (event.text.trim() === "/compact") break;
        close();
        turn++;
        const who = event.by && event.by.toLowerCase() !== chat.owner ? event.by : "Person";
        const files = event.attachments.length ? ` [attached: ${event.attachments.map((a) => a.name).join(", ")}]` : "";
        out.push("", `## ${turn} · ${day(at)}`, `${who}: ${cut(event.text, askLimit)}${files}`);
        break;
      }
      /* The answer a turn ends with is its last text; what came before it was working out loud. */
      case "text": answer = event.text; break;
      case "artifact": if (event.action !== "shown") notes.push(`[${event.action === "edited" ? "changed" : "made"} artifact ${event.name}]`); break;
      case "sent": notes.push(`[sent ${event.files.map((f) => f.name).join(", ")}]`); break;
      case "done": if (!event.ok && !event.cancelled) notes.push("[it stopped with an error]"); break;
      default: break;
    }
  }
  close();
  return `${out.join("\n")}\n`;
}

/** One line a chat: id, last active, title, project, and how it began. Newest first. */
function indexOf(db: DatabaseSync, chats: Workspace[]): string {
  const rows = chats.map((chat) => {
    const first = (eventsAfter(db, chat.id, 0, 400) as { event: CodeEvent }[]).find((e) => e.event.kind === "ask")?.event as Extract<CodeEvent, { kind: "ask" }> | undefined;
    return [chat.id, day(chat.updatedAt), line(chat.title, 100), chat.folder?.name ?? "", line(first?.text ?? "", 140)].join("\t");
  });
  return `${["id\tdate\ttitle\tproject\tbegan with", ...rows].join("\n")}\n`;
}

const encode = (text: string) => new TextEncoder().encode(text);

/** Whether a chat has been shared with anyone, or has a link. */
function shared(db: DatabaseSync, id: string) {
  return Boolean(db.prepare("SELECT 1 FROM chat_shares WHERE workspace_id = ? UNION SELECT 1 FROM chat_links WHERE workspace_id = ?").get(id, id));
}

/**
 * Brings the sandbox's copy of the person's other chats up to date, writing
 * only what changed. Returns whether the chat has them, for the instructions.
 */
export async function syncHistory(db: DatabaseSync, config: CodeConfig, workspace: Workspace): Promise<boolean> {
  const kept = new Map((db.prepare("SELECT chat_id, seq FROM history_synced WHERE workspace_id = ?").all(workspace.id) as { chat_id: string; seq: number }[]).map((r) => [r.chat_id, r.seq]));
  const forget = async (id: string, file: string) => {
    await sandbox.removeFile(config, workspace, `${historyDir}/${file}`).catch(() => {});
    db.prepare("DELETE FROM history_synced WHERE workspace_id = ? AND chat_id = ?").run(workspace.id, id);
  };
  if (shared(db, workspace.id)) {
    for (const id of kept.keys()) await forget(id, id === "" ? "index.tsv" : `${id}.md`);
    return false;
  }
  const chats = workspacesOf(db, workspace.owner).filter((chat) => chat.id !== workspace.id && chat.lastSeq > 0);
  const present = new Set(chats.map((chat) => chat.id));
  let changed = false;
  for (const id of kept.keys()) if (id !== "" && !present.has(id)) { await forget(id, `${id}.md`); changed = true; }
  for (const chat of chats) {
    if (kept.get(chat.id) === chat.lastSeq) continue;
    await sandbox.write(config, workspace, `${historyDir}/${chat.id}.md`, encode(digestOf(db, chat)));
    db.prepare("INSERT INTO history_synced (workspace_id, chat_id, seq) VALUES (?, ?, ?) ON CONFLICT (workspace_id, chat_id) DO UPDATE SET seq = excluded.seq").run(workspace.id, chat.id, chat.lastSeq);
    changed = true;
  }
  if (changed || !kept.has("")) {
    await sandbox.write(config, workspace, `${historyDir}/index.tsv`, encode(indexOf(db, chats)));
    db.prepare("INSERT INTO history_synced (workspace_id, chat_id, seq) VALUES (?, '', 0) ON CONFLICT DO NOTHING").run(workspace.id);
  }
  return chats.length > 0;
}

/** What Kimono AI is told about its earlier chats, when it has them. */
export const historyNote = "The person's earlier chats with you are in /workspace/.kimono/chats (the question and the answer of each turn). When they refer to something from before, or it would help to know what you did then, look rather than guess: `kimono-chats search \"<words>\"` finds the chats and the lines that match, `kimono-chats list` shows the most recent, and `kimono-chats read <id>` reads one a part at a time (`--turn <n>` to go on). Don't read whole chats you don't need.";
