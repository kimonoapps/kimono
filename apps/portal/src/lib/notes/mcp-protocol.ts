/**
 * 帳 Kimono Notes over MCP: the protocol, without the server.
 *
 * Streamable HTTP, stateless: every POST carries JSON-RPC and is answered in
 * JSON. There are no sessions and no server-sent stream, which the spec
 * leaves to the server. The tools act on the signed-in person's notes; what
 * they do is given in, so this file stays pure (scripts/test-notes-mcp.mjs).
 */

export const protocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const latestProtocol = protocolVersions[0];

/** The client's version if it is one spoken here, else the newest (the client then decides). */
export function negotiate(asked: unknown): string {
  return typeof asked === "string" && (protocolVersions as readonly string[]).includes(asked) ? asked : latestProtocol;
}

/** A version header the server doesn't speak is refused; none at all means the oldest the transport allows. */
export const knownProtocolHeader = (header: string | null) => header === null || (protocolVersions as readonly string[]).includes(header);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };

export type ToolDefinition = {
  name: string; title: string; description: string; inputSchema: Schema;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
};

const id = (what: string) => ({ type: "string", description: what, minLength: 1 });

export const tools: ToolDefinition[] = [
  {
    name: "list_notebooks", title: "List notebooks",
    description: "Your notebooks and the sections in them. A notebook is in a space and shared with everyone in that space; place is its readable name (\"Space / Notebook\"). A note goes in a notebook or a section: either's id is a parent.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List notebooks", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "search_notes", title: "Search notes",
    description: "Finds notes whose title or text has every word of the query, best matches first. Leave out the query for the most recently changed notes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find in titles and text." },
        notebook: { type: "string", description: "Only notes in this notebook (its id)." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: { title: "Search notes", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "read_note", title: "Read a note",
    description: "A note's Markdown text, with its version and the notebook it is in. Send that version back with update_note.",
    inputSchema: { type: "object", properties: { id: id("The note's id.") }, required: ["id"], additionalProperties: false },
    annotations: { title: "Read a note", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_note", title: "Create a note",
    description: "A new Markdown note. Without a parent it goes in your first notebook.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The note's title." },
        text: { type: "string", description: "The note's Markdown. Don't repeat the title as a heading." },
        parent: { type: "string", description: "A notebook's or a section's id, from list_notebooks." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { title: "Create a note", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "update_note", title: "Update a note",
    description: "Replaces a note's text and/or changes its title. Send the version you read: if someone saved since, theirs stays, yours is kept as a copy beside it, and the answer says so.",
    inputSchema: {
      type: "object",
      properties: {
        id: id("The note's id."),
        version: { type: "integer", description: "The version read_note gave." },
        text: { type: "string", description: "The whole new Markdown text." },
        title: { type: "string", description: "A new title." },
      },
      required: ["id", "version"],
      additionalProperties: false,
    },
    annotations: { title: "Update a note", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "move_note", title: "Move a note",
    description: "Moves a note to a section, or to the top of a notebook (the notebook's id).",
    inputSchema: {
      type: "object",
      properties: { id: id("The note's id."), parent: id("A section's or a notebook's id.") },
      required: ["id", "parent"],
      additionalProperties: false,
    },
    annotations: { title: "Move a note", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "delete_note", title: "Delete a note",
    description: "Moves a note to the trash. It can be restored from the trash for 30 days.",
    inputSchema: { type: "object", properties: { id: id("The note's id.") }, required: ["id"], additionalProperties: false },
    annotations: { title: "Delete a note", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

/** A refusal a person can read, shown to the model as a failed tool call rather than a protocol error. */
export class ToolProblem extends Error {}

/** Checks arguments against a tool's schema: known keys only, the right types, the required ones present. */
export function argumentsFor(tool: ToolDefinition, raw: unknown): Record<string, unknown> {
  const args = raw === undefined || raw === null ? {} : raw;
  if (typeof args !== "object" || Array.isArray(args)) throw new ToolProblem("Send the arguments as an object.");
  const input = args as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!(key in tool.inputSchema.properties)) throw new ToolProblem(`${tool.name} doesn't take "${key}".`);
  for (const key of tool.inputSchema.required || []) if (input[key] === undefined || input[key] === "") throw new ToolProblem(`Send "${key}".`);
  for (const [key, value] of Object.entries(input)) {
    const type = (tool.inputSchema.properties[key] as { type: string }).type;
    if (value === undefined) continue;
    if (type === "integer" ? !Number.isSafeInteger(value) : typeof value !== type) throw new ToolProblem(`"${key}" should be ${type === "integer" ? "a whole number" : `a ${type}`}.`);
  }
  return input;
}

export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

export const toolResult = (value: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value });
export const toolError = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

export type Runner = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Reply = { jsonrpc: "2.0"; id: Json; result?: unknown; error?: { code: number; message: string } };

const instructions = "Kimono Notes holds the household's notebooks of Markdown notes. Search or list before reading; read a note before updating it, and send back the version you read.";

const failure = (id: Json, code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });

/** One JSON-RPC message. Notifications and responses get no answer (null). */
export async function answer(message: unknown, run: Runner, server = { name: "kimono-notes", version: "1.0.0" }): Promise<Reply | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return failure(null, -32600, "Send a JSON-RPC message.");
  const { jsonrpc, id, method, params } = message as Message;
  if (jsonrpc !== "2.0") return failure(null, -32600, "Send JSON-RPC 2.0.");
  if (method === undefined) return null; /* A response to something we never ask. */
  if (typeof method !== "string") return failure(null, -32600, "Name the method.");
  if (id === undefined) return null; /* A notification, such as notifications/initialized. */
  if (typeof id !== "string" && typeof id !== "number") return failure(null, -32600, "The id should be a string or a number.");
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  switch (method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: {
        protocolVersion: negotiate(p.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { ...server, title: "Kimono Notes" },
        instructions,
      } };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools } };
    case "tools/call": {
      const tool = tools.find((candidate) => candidate.name === p.name);
      if (!tool) return failure(id, -32602, `There's no tool called ${String(p.name)}.`);
      try {
        return { jsonrpc: "2.0", id, result: toolResult(await run(tool.name, argumentsFor(tool, p.arguments))) };
      } catch (error) {
        if (error instanceof ToolProblem) return { jsonrpc: "2.0", id, result: toolError(error.message) };
        throw error;
      }
    }
    default:
      return failure(id, -32601, `${method} isn't offered here.`);
  }
}

/** A POST body: one message, or (before 2025-06-18) a batch. Null when nothing needs an answer. */
export async function answerAll(body: unknown, run: Runner): Promise<Reply | Reply[] | null> {
  if (!Array.isArray(body)) return answer(body, run);
  if (!body.length) return failure(null, -32600, "That batch is empty.");
  const replies = (await Promise.all(body.map((message) => answer(message, run)))).filter((reply): reply is Reply => reply !== null);
  return replies.length ? replies : null;
}

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export const termsOf = (query: string) => [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 12);

export type Searchable = { id: string; title: string; text: string; updatedAt: number };

/**
 * Notes with every term in their title or text. Title matches count most, the
 * whole query as a title most of all; then how often the terms appear; then
 * the newest. No terms: the newest notes.
 */
export function rank<T extends Searchable>(notes: T[], query: string, limit: number): { note: T; snippet: string }[] {
  const terms = termsOf(query);
  const scored: { note: T; score: number; at: number }[] = [];
  for (const note of notes) {
    if (!terms.length) { scored.push({ note, score: 0, at: -1 }); continue; }
    const title = fold(note.title), text = fold(note.text);
    let score = 0, first = -1, every = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const at = text.indexOf(term);
      if (!inTitle && at < 0) { every = false; break; }
      if (inTitle) score += 10;
      if (at >= 0) {
        score += Math.min(5, text.split(term).length - 1);
        if (first < 0 || at < first) first = at;
      }
    }
    if (!every) continue;
    const whole = fold(query).trim();
    if (title === whole) score += 100;
    else if (title.includes(whole)) score += 30;
    scored.push({ note, score, at: first });
  }
  scored.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
  return scored.slice(0, limit).map(({ note, at }) => ({ note, snippet: snippetOf(note.text, at) }));
}

/**
 * About 200 characters of the text around [at] (folded offsets are close
 * enough for a preview), on one line.
 */
export function snippetOf(text: string, at: number, width = 200): string {
  const chars = [...text];
  const start = at <= 0 ? 0 : Math.max(0, Math.min(at - 60, chars.length - width));
  const piece = chars.slice(start, start + width).join("").replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}${start + width < chars.length ? "…" : ""}`;
}
