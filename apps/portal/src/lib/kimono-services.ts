import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";

/*
 * Kimono's own services (sign-in, the VPN, the web proxy, the database) run
 * beside the Portal, which can't touch them: only the reconciler holds Docker.
 * It writes what it sees to services/status.json every few seconds, starts what
 * has stopped by itself, and restarts one when the Portal leaves
 * services/request.json (cli/internal/services).
 */
const dir = join(stateDir, "services");

export const kimonoServices = [
  { id: "authentik-server", label: "Sign-in", detail: "Accounts and signing in to every app" },
  { id: "authentik-worker", label: "Sign-in tasks", detail: "Invitations, emails and background work for sign-in" },
  { id: "headscale", label: "VPN", detail: "Connects your devices to each other" },
  { id: "caddy", label: "Web addresses", detail: "Answers on your domain and keeps its certificates" },
  { id: "postgresql", label: "Database", detail: "Where accounts are kept" },
  { id: "portal", label: "Portal", detail: "This website; it is back within a minute" },
] as const;

export type KimonoServiceId = (typeof kimonoServices)[number]["id"];
export type ServiceState = { id: string; state: string; health: string; startedAt?: string };
export type ServiceOutcome = { id?: string; service: string; asked: boolean; ok: boolean; message?: string; at: string };
export type ServicesStatus = { updatedAt: string; services: ServiceState[]; last?: ServiceOutcome };

/** The reconciler writes every 15 seconds; a minute without means it isn't looking after them. */
const staleAfter = 60_000;

export async function readServicesStatus(): Promise<{ status: ServicesStatus | null; watched: boolean; pending: boolean }> {
  const [text, pending] = await Promise.all([
    readFile(join(dir, "status.json"), "utf8").catch(() => null),
    readFile(join(dir, "request.json"), "utf8").then(() => true, () => false),
  ]);
  let status: ServicesStatus | null = null;
  try { status = text ? JSON.parse(text) as ServicesStatus : null; } catch { status = null; }
  const watched = Boolean(status && Date.now() - Date.parse(status.updatedAt) < staleAfter);
  return { status, watched, pending };
}

/** Whether a service is doing its job, as a person would say it. */
export function describeService(state: ServiceState | undefined): { ok: boolean; label: string } {
  if (!state || state.state === "missing") return { ok: false, label: "Not installed" };
  if (state.state === "restarting") return { ok: false, label: "Restarting" };
  if (state.state !== "running") return { ok: false, label: "Stopped" };
  if (state.health === "unhealthy") return { ok: false, label: "Not answering" };
  if (state.health === "starting") return { ok: true, label: "Starting" };
  return { ok: true, label: "Running" };
}

export async function requestServiceRestart(service: string) {
  if (!kimonoServices.some((known) => known.id === service)) throw new Error("That isn't something Kimono can restart.");
  await mkdir(dir, { recursive: true, mode: 0o755 });
  try {
    await writeFile(join(dir, "request.json"), JSON.stringify({ id: randomUUID(), service }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A restart is already on its way.");
    throw error;
  }
}
