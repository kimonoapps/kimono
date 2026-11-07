import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { portalOrigin } from "../account";
import { readLimited } from "../api-v1";
import { readStanding } from "../directory";
import { db as driveDb, DriveProblem, moveNode, renameNode, trashNode } from "../drive";
import { signedOutBefore } from "../session-epochs";
import { appHostname, getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { notesAppId, notesConfig } from "./config";
import { createNote, libraryOf, noteFor, noteName, notebooksOf, placeFor, saveNote, textOf, type NoteMeta } from "./index";
import { clientFor, migrateOAuth, notesScope, OAuthProblem, redirectMatches, scopeFrom, validChallenge, verifyAccess, type Client } from "./mcp-oauth";
import { rank, ToolProblem, type Runner } from "./mcp-protocol";

/**
 * 帳 The MCP server's place in the Portal: its sign-in records, the address
 * it answers on, who a request speaks for, and its tools over the notes.
 */

const cache = globalThis as unknown as { kimonoNotesOAuth?: DatabaseSync };

export function oauthDb(): DatabaseSync {
  if (!cache.kimonoNotesOAuth) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(join(stateDir, "notes-mcp.db"));
    migrateOAuth(opened);
    cache.kimonoNotesOAuth = opened;
  }
  return cache.kimonoNotesOAuth;
}

/** The addresses the MCP server answers on: Notes' own (the one Outline's MCP had), and the Portal's. */
export async function mcpOrigins(): Promise<{ notes: string | null; all: string[] }> {
  const settings = await getPlatformSettings();
  const instance = settings.apps[notesAppId];
  const notes = instance ? `https://${appHostname(instance.domain, settings.baseDomain)}` : null;
  return { notes, all: [...new Set([notes, portalOrigin()].filter((origin): origin is string => Boolean(origin)))] };
}

/** The origin the request was sent to, if it's one of ours; otherwise Notes' own. */
export async function originOf(request: Request): Promise<string> {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  const proto = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "")).split(",")[0].trim();
  const asked = `${proto}://${host}`;
  const { notes, all } = await mcpOrigins();
  return all.includes(asked) ? asked : notes || portalOrigin();
}

export async function notesOn(): Promise<boolean> {
  return notesConfig(await getPlatformSettings()).enabled;
}

export const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** RFC 6749's error shape, for the token, registration and revocation endpoints. */
export function oauthError(error: unknown) {
  if (error instanceof OAuthProblem) return Response.json({ error: error.code, error_description: error.message }, { status: error.status, headers: noStore });
  console.warn("Notes sign-in failed:", error instanceof Error ? error.message : error);
  return Response.json({ error: "server_error", error_description: "That didn't work. Try again in a moment." }, { status: 500, headers: noStore });
}

/** A form-encoded body, as the token and revocation endpoints take. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") throw new OAuthProblem("invalid_request", "Send the request form-encoded.");
  const bytes = await readLimited(request, 16 * 1024);
  if (!bytes) throw new OAuthProblem("invalid_request", "That request is too large.", 413);
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

/**
 * The person a bearer token speaks for, as /api/v1 checks the phone app's:
 * the token is live and for this address, the person hasn't signed out
 * everywhere since allowing it, and their account is still on.
 */
export async function mcpUser(request: Request, origin: string): Promise<{ username: string } | Response> {
  const challenge = (error?: string) => new Response(JSON.stringify({ error: error ? "invalid_token" : "unauthorized", error_description: "Sign in to Kimono Notes." }), {
    status: 401,
    headers: {
      ...noStore, "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${notesScope}"${error ? `, error="${error}"` : ""}`,
    },
  });
  const header = request.headers.get("authorization");
  if (!header) return challenge();
  const bearer = /^Bearer\s+(\S+)$/i.exec(header);
  if (!bearer) return challenge("invalid_token");
  const access = verifyAccess(oauthDb(), bearer[1], `${origin}/mcp`);
  if (!access) return challenge("invalid_token");
  if (access.grantedAt < await signedOutBefore(access.username)) return challenge("invalid_token");
  const standing = await readStanding(access.username);
  if (standing && !standing.active) return challenge("invalid_token");
  return { username: access.username };
}

export type AuthorizationRequest = { client: Client; redirectUri: string; challenge: string; resource: string; issuer: string; state?: string };

/**
 * An authorization request, checked. Until the client and its redirect URI
 * are known good, a problem is shown, never sent anywhere ({ show }); after,
 * it goes back to the client ({ back }).
 */
export async function authorizationRequest(params: URLSearchParams): Promise<AuthorizationRequest | { show: string } | { back: string; error: string; description: string; state?: string; issuer: string }> {
  const client = clientFor(oauthDb(), params.get("client_id"));
  if (!client) return { show: "That app isn't known here. Try connecting it again." };
  const asked = params.get("redirect_uri") || (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!asked || !redirectMatches(client.redirectUris, asked)) return { show: "That app asked to go somewhere it didn't register." };
  const state = params.get("state") ?? undefined;
  const { notes, all } = await mcpOrigins();
  const resource = params.get("resource") || `${notes || portalOrigin()}/mcp`;
  const origin = all.find((candidate) => `${candidate}/mcp` === resource.replace(/\/$/, ""));
  const issuer = origin || notes || portalOrigin();
  const back = (error: string, description: string) => ({ back: asked, error, description, state, issuer });
  if (params.get("response_type") !== "code") return back("unsupported_response_type", "Only the code response type is offered.");
  if (!origin) return back("invalid_target", "That resource isn't served here.");
  if (!validChallenge(params.get("code_challenge")) || params.get("code_challenge_method") !== "S256") return back("invalid_request", "Send a PKCE code_challenge, method S256.");
  if (!scopeFrom(params.get("scope") ?? undefined)) return back("invalid_scope", `Only the ${notesScope} scope is offered.`);
  return { client, redirectUri: asked, challenge: params.get("code_challenge")!, resource: `${origin}/mcp`, issuer, state };
}

/* What a tool hands back about a note. */
const shown = (note: NoteMeta) => ({ id: note.id, title: note.title, notebookId: note.notebookId, parentId: note.parentId, version: note.version, createdBy: note.createdBy, updatedAt: new Date(note.updatedAt).toISOString() });
const bare = <T extends { blob: string | null }>({ blob, ...rest }: T) => { void blob; return rest; };

/** The tools, acting as [username]. Drive's rules decide what they may see and change. */
export function runnerFor(username: string): Runner {
  const work: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>> = {
    list_notebooks: () => {
      const { notebooks, sections } = libraryOf(driveDb(), username);
      return {
        notebooks: notebooks.map((book) => ({ id: book.id, name: book.name, role: book.role })),
        sections: sections.map((section) => ({ id: section.id, notebookId: section.notebookId, parentId: section.parentId, name: section.name })),
      };
    },
    search_notes: async ({ query, notebook, limit }) => {
      const found = libraryOf(driveDb(), username).notes.filter((note) => !notebook || note.notebookId === notebook);
      const texts = await Promise.all(found.map(async (note) => ({ ...note, text: await textOf(note.blob) })));
      const hits = rank(texts, typeof query === "string" ? query : "", typeof limit === "number" ? Math.min(50, Math.max(1, limit)) : 10);
      return { notes: hits.map(({ note, snippet }) => ({ ...shown(note), snippet })) };
    },
    read_note: async ({ id }) => {
      const note = noteFor(driveDb(), String(id), username);
      const notebook = notebooksOf(driveDb(), username).find((book) => book.id === note.notebookId);
      return { ...shown(note), notebook: notebook?.name ?? null, text: await textOf(note.blob) };
    },
    create_note: async ({ title, text, parent }) => shown(await createNote(username, { title, text, parent })),
    update_note: async ({ id, version, text, title }) => {
      const current = bare(noteFor(driveDb(), String(id), username, "editor"));
      if (text === undefined && title === undefined) throw new ToolProblem("Send new text, a new title, or both.");
      if (text === undefined && current.version !== version) throw new ToolProblem("This note changed since you read it. Read it again first.");
      if (text !== undefined) {
        const saved = await saveNote(username, current.id, { text, version });
        if (saved.conflict) return {
          conflict: true, note: shown(current), copy: shown(saved.note),
          message: `Someone saved this note since you read it. Their text stays; yours was saved beside it as "${saved.note.title}". Read both and merge them.`,
        };
      }
      if (title !== undefined) renameNode(driveDb(), current.id, username, noteName(title));
      return { conflict: false, note: shown(bare(noteFor(driveDb(), current.id, username))) };
    },
    move_note: ({ id, parent }) => {
      noteFor(driveDb(), String(id), username, "editor");
      placeFor(driveDb(), String(parent), username);
      moveNode(driveDb(), String(id), username, String(parent));
      return shown(bare(noteFor(driveDb(), String(id), username)));
    },
    delete_note: ({ id }) => {
      const note = noteFor(driveDb(), String(id), username, "editor");
      trashNode(driveDb(), note.id, username);
      return { trashed: true, id: note.id, title: note.title };
    },
  };
  return async (name, args) => {
    try {
      return await work[name](args);
    } catch (error) {
      if (error instanceof ToolProblem) throw error;
      if (error instanceof DriveProblem) throw new ToolProblem(error.message);
      console.warn(`Notes MCP ${name} failed:`, error instanceof Error ? error.message : error);
      throw new ToolProblem("Notes couldn't do that. Try again in a moment.");
    }
  };
}
