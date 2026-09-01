export type TunnelProvider = {
  id: string;
  name: string;
  connectorImage: string;
  description: string;
  modes: readonly string[];
  authenticationUrl?: string;
};

export type CloudflareTunnelToken = {
  token: string;
  accountId?: string;
  tunnelId?: string;
};

const installedProviders: TunnelProvider[] = [
  {
    id: "direct",
    name: "Direct (Dynamic DNS)",
    connectorImage: "",
    description: "Publishes on this server's own address. Hostnames follow the record Dynamic DNS keeps current.",
    modes: ["cname"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Tunnel",
    connectorImage: "cloudflare/cloudflared:2026.8.0",
    description: "Outbound connector authenticated with a tunnel-scoped token.",
    modes: ["remote-token", "local-credentials"],
    authenticationUrl: "https://one.dash.cloudflare.com/",
  },
];

export function listTunnelProviders() { return installedProviders; }

/** A provider with no connector image is served by the appliance's own proxy. */
export function providerRunsConnector(id: string) { return Boolean(getTunnelProvider(id)?.connectorImage); }
export function getTunnelProvider(id: string) { return installedProviders.find((provider) => provider.id === id); }

function commandToken(value: string) {
  for (const pattern of [
    /--token(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i,
    /\bservice\s+install\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i,
  ]) {
    const match = value.match(pattern);
    if (match) return match[1] || match[2] || match[3];
  }
  return null;
}

export function parseCloudflareTunnelToken(input: string): CloudflareTunnelToken {
  const submitted = input.trim();
  if (!submitted) throw new Error("Paste the Cloudflare tunnel token or install command");
  const extracted = commandToken(submitted);
  if (!extracted && /\b(?:cloudflared|docker)\b/i.test(submitted)) throw new Error("The command does not contain a Cloudflare --token value");
  const token = extracted || submitted;
  if (token.length < 40 || /\s/.test(token)) throw new Error("That does not look like a Cloudflare tunnel token");

  try {
    const normalized = token.replaceAll("-", "+").replaceAll("_", "/");
    const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { a?: unknown; t?: unknown };
    const accountId = typeof payload.a === "string" ? payload.a : undefined;
    const tunnelId = typeof payload.t === "string" ? payload.t : undefined;
    return { token, accountId, tunnelId };
  } catch {
    return { token };
  }
}
