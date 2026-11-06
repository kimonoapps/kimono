import "server-only";

import type { CodeConfig } from "./config";
import type { Workspace } from "./model";
import { sandbox } from "./node";

/*
 * A chat's name, from its first exchange: a few words, like a person would
 * file it under. Haiku writes it through Claude Code in the chat's sandbox
 * (the node's /name). Anything going wrong leaves the name the chat started with.
 */
export async function suggestTitle(config: CodeConfig, workspace: Workspace, asked: string, answered: string): Promise<string | null> {
  if (!asked.trim()) return null;
  const conversation = `Person: ${asked.slice(0, 2000)}${answered.trim() ? `\n\nAssistant: ${answered.slice(0, 1500)}` : ""}`;
  try {
    return cleanTitle((await sandbox.name(config, workspace, conversation)).title);
  } catch (error) {
    console.warn("Kimono AI couldn't name a chat:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** One line, no wrapping quotes or "Title:", no full stop, at most 60 characters. */
export function cleanTitle(raw: string): string | null {
  let line = raw.trim().split("\n")[0]?.trim() ?? "";
  line = line.replace(/^(title|name)\s*:\s*/i, "").replace(/^["'“‘`*_#\s]+|["'”’`*_\s]+$/g, "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
