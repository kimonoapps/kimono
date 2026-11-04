/*
 * What a workspace's timeline is made of. The node streams Claude Code's own
 * stream-json lines; they are turned into these few kinds before they are
 * stored, so the web page and the phone app read one small vocabulary and
 * neither has to know Claude Code's format.
 */

export type Attachment = { name: string; path: string; size: number; type: string };

export type CodeEvent =
  | { kind: "ask"; by: string; text: string; attachments: Attachment[] }
  | { kind: "started" }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; label: string; detail?: string }
  | { kind: "tool-result"; id: string; ok: boolean; output: string }
  | { kind: "done"; ok: boolean; cancelled?: boolean; error?: string; costUsd?: number; durationMs?: number }
  | { kind: "published"; url: string; number: number }
  | { kind: "image"; name: string; caption?: string }
  | { kind: "preview"; url: string; port: number }
  | { kind: "preview-stopped" };

const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}\n…` : value;

/** The one argument worth showing beside a tool: the file it touched, the command it ran, what it searched for. */
function toolLabel(name: string, input: Record<string, unknown>): { label: string; detail?: string } {
  const text = (key: string) => typeof input[key] === "string" ? input[key] as string : undefined;
  const path = text("file_path") ?? text("path") ?? text("notebook_path");
  const short = (value: string) => value.replace(/^\/workspace\/?/, "") || ".";
  switch (name) {
    case "Bash": return { label: "Ran", detail: clip(text("command") ?? "", 400) };
    case "Read": return { label: "Read", detail: path && short(path) };
    case "Write": return { label: "Wrote", detail: path && short(path) };
    case "Edit": case "MultiEdit": case "NotebookEdit": return { label: "Edited", detail: path && short(path) };
    case "Grep": return { label: "Searched for", detail: text("pattern") };
    case "Glob": return { label: "Looked for", detail: text("pattern") };
    case "WebFetch": return { label: "Fetched", detail: text("url") };
    case "WebSearch": return { label: "Searched the web for", detail: text("query") };
    case "TodoWrite": return { label: "Updated its plan" };
    case "Task": case "Agent": return { label: "Asked a helper", detail: text("description") };
    default: return { label: name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " "), detail: path && short(path) };
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("\n");
  return "";
}

export type TurnResult = { failure?: string; costUsd?: number; durationMs?: number };
export type Translated = { events: CodeEvent[]; session?: string; result?: TurnResult };

/**
 * One line from the node, as zero or more timeline events. Lines it doesn't
 * know (system notices, stderr, partial tokens) produce nothing; the session id
 * is picked out wherever it appears so the next turn can resume.
 */
export function translate(line: unknown): Translated {
  if (!line || typeof line !== "object") return { events: [] };
  const message = line as Record<string, unknown>;
  const session = typeof message.session_id === "string" ? message.session_id : typeof message.session === "string" && message.session ? message.session : undefined;
  const content = (message.message as { content?: unknown } | undefined)?.content;
  const parts = Array.isArray(content) ? content as Record<string, unknown>[] : [];
  switch (message.type) {
    case "assistant": {
      const events: CodeEvent[] = [];
      for (const part of parts) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) events.push({ kind: "text", text: part.text });
        if (part.type === "tool_use" && typeof part.id === "string" && typeof part.name === "string") {
          events.push({ kind: "tool", id: part.id, name: part.name, ...toolLabel(part.name, (part.input as Record<string, unknown>) ?? {}) });
        }
      }
      return { events, session };
    }
    case "user": {
      const events: CodeEvent[] = [];
      for (const part of parts) {
        if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
          events.push({ kind: "tool-result", id: part.tool_use_id, ok: part.is_error !== true, output: clip(resultText(part.content), 4000) });
        }
      }
      return { events, session };
    }
    case "result": {
      const failed = message.is_error === true || (typeof message.subtype === "string" && message.subtype !== "success");
      return {
        events: [],
        session,
        result: {
          ...(failed ? { failure: typeof message.result === "string" && message.result ? message.result : "The agent stopped with an error." } : {}),
          ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}),
          ...(typeof message.duration_ms === "number" ? { durationMs: message.duration_ms } : {}),
        },
      };
    }
    default:
      return { events: [], session };
  }
}

/** What a finished turn says about itself, gathered from Claude's result line and the node's done line. */
export function finish(result: TurnResult | null, done: { exit?: number; cancelled?: boolean } | null, error?: string): Extract<CodeEvent, { kind: "done" }> {
  if (done?.cancelled) return { kind: "done", ok: false, cancelled: true };
  const failure = error ?? result?.failure ?? (done && done.exit !== 0 ? "The agent stopped with an error." : undefined) ?? (!done ? "The sandbox stopped answering." : undefined);
  return {
    kind: "done", ok: !failure, ...(failure ? { error: clip(failure, 600) } : {}),
    ...(result?.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    ...(result?.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
  };
}
