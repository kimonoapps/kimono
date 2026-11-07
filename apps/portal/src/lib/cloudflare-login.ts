import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getPlatformSettings, provisionLocalCloudflareTunnel } from "./settings";

type LoginStatus = "waiting" | "creating" | "complete" | "error";
type LoginSession = { id: string; localId: string; name: string; domain: string; home: string; status: LoginStatus; startedAt?: number; authUrl?: string; error?: string; tunnelId?: string; process?: ChildProcess };

const globalSessions = globalThis as typeof globalThis & { __kimonoCloudflareLogins?: Map<string, LoginSession> };
const sessions = globalSessions.__kimonoCloudflareLogins ||= new Map<string, LoginSession>();
const root = process.env.NODE_ENV === "production" ? "/var/lib/kimono-portal/cloudflare" : "/tmp/kimono-cloudflare";
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63) || "cloudflare";
}

const containerHome = "/tmp/cloudflared-home";

function invocation(home: string, args: (path: { cert: string }) => string[]) {
  const configured = process.env.CLOUDFLARED_BIN;
  const binary = configured || "/usr/local/bin/cloudflared";
  const certPath = join(home, ".cloudflared", "cert.pem");
  if (existsSync(binary)) return { command: binary, args: args({ cert: certPath }), env: { ...process.env, HOME: home }, certPath };
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return {
    command: "docker",
    args: ["run", "--rm", "--user", `${uid}:${gid}`, "--env", `HOME=${containerHome}`, "--volume", `${home}:${containerHome}`, "cloudflare/cloudflared:2026.8.0", ...args({ cert: join(containerHome, ".cloudflared", "cert.pem") })],
    env: process.env,
    certPath,
  };
}

function execute(home: string, args: (path: { cert: string }) => string[]) {
  const command = invocation(home, args);
  const child = spawn(command.command, command.args, { env: command.env, stdio: ["ignore", "pipe", "pipe"] });
  return { child, certPath: command.certPath };
}

async function commandOutput(home: string, args: (path: { cert: string }) => string[]) {
  return new Promise<string>((resolve, reject) => {
    const { child } = execute(home, args);
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output) : reject(new Error(output.trim() || `cloudflared exited with status ${code}`)));
  });
}

async function finishLogin(session: LoginSession, certPath: string) {
  try {
    if (!existsSync(certPath)) throw new Error("Cloudflare login finished without creating cert.pem");
    session.status = "creating";
    const directory = join(session.home, ".cloudflared");
    const before = new Set((await readdir(directory)).filter((file) => file.endsWith(".json")));
    await commandOutput(session.home, (path) => ["tunnel", "--origincert", path.cert, "create", "--", session.name]);
    const credentialsName = (await readdir(directory)).find((file) => file.endsWith(".json") && !before.has(file));
    if (!credentialsName) throw new Error("cloudflared created the tunnel without a credentials file");
    const credentialsFile = join(directory, credentialsName);
    const credentials = JSON.parse(await readFile(credentialsFile, "utf8")) as { AccountTag?: string; TunnelID?: string };
    const tunnelId = credentials.TunnelID || credentialsName.replace(/\.json$/, "");
    await Promise.all([chmod(certPath, 0o600), chmod(credentialsFile, 0o600)]);
    await provisionLocalCloudflareTunnel({ localId: session.localId, name: session.name, domain: session.domain, accountId: credentials.AccountTag, tunnelId, credentialsFile, originCertificate: certPath });
    session.tunnelId = tunnelId;
    session.status = "complete";
  } catch (error) {
    session.status = "error";
    session.error = error instanceof Error ? error.message : "Cloudflare tunnel could not be created";
  }
}

/* A login nobody finishes within half an hour is let go, process and all. */
const loginLifetime = 30 * 60 * 1000;
function forgetStaleLogins(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (now - (session.startedAt ?? now) < loginLifetime) continue;
    if (session.process && session.process.exitCode === null) session.process.kill();
    sessions.delete(id);
  }
}

export async function startCloudflareLogin(input: { name: string; domain: string }) {
  const name = input.name.trim();
  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!name) throw new Error("Give the tunnel a name");
  if (name.startsWith("-") || name.length > 100) throw new Error("Give the tunnel a shorter name that doesn't start with a dash");
  forgetStaleLogins();
  if (!domainPattern.test(domain)) throw new Error("Enter the Cloudflare domain you will authorize");
  const settings = await getPlatformSettings();
  const base = slug(name);
  let localId = base;
  for (let suffix = 2; settings.tunnels[localId]?.configuration.TUNNEL_ID; suffix += 1) localId = `${base.slice(0, 59)}-${suffix}`;
  const id = randomUUID();
  const home = join(root, id);
  await mkdir(join(home, ".cloudflared"), { recursive: true, mode: 0o700 });
  const session: LoginSession = { id, localId, name, domain, home, status: "waiting", startedAt: Date.now() };
  sessions.set(id, session);
  const { child, certPath } = execute(home, () => ["tunnel", "login"]);
  session.process = child;

  return new Promise<{ sessionId: string; authUrl: string }>((resolve, reject) => {
    let output = "";
    let settled = false;
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const url = output.match(/https:\/\/dash\.cloudflare\.com\/argotunnel[^\s]*/)?.[0];
      if (url && !settled) { settled = true; session.authUrl = url; resolve({ sessionId: id, authUrl: url }); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      session.status = "error"; session.error = error.message;
      if (!settled) { settled = true; reject(error); }
    });
    child.once("close", (code) => {
      session.process = undefined;
      if (code === 0) void finishLogin(session, certPath);
      else { session.status = "error"; session.error = output.trim() || `cloudflared login exited with status ${code}`; }
      if (!settled) { settled = true; reject(new Error(session.error || "cloudflared login ended before authorization")); }
    });
    setTimeout(() => {
      if (!settled) { settled = true; child.kill(); session.status = "error"; session.error = "cloudflared did not provide an authorization URL"; reject(new Error(session.error)); }
    }, 15_000);
  });
}

export function getCloudflareLogin(id: string) {
  const session = sessions.get(id);
  if (!session) return null;
  return { status: session.status, error: session.error, localId: session.localId, tunnelId: session.tunnelId };
}
