# Kimono

Kimono is a lightweight, self-hosted household application platform. It gives
first-party apps, maintained forks, and connected services one calm interface,
one account, and one administration surface.

## Workspace

- `apps/portal` — the household portal and embedded administration area
- `cli` — the single `kimono` binary for both server and application VMs
- `packages/ui` — shared Kimono interface primitives
- `packages/app-sdk` — the platform contract used by Kimono applications
- `docs/decisions` — architectural decisions and their tradeoffs
- `infra/compose` — local infrastructure as it is introduced

## Start locally

```bash
pnpm install
pnpm dev
```

The portal runs at `http://localhost:3000`.

## Install Kimono on VMs

Build the one distributable CLI and install it locally:

```bash
pnpm cli:test
pnpm cli:build
sudo install -m 0755 dist/kimono /usr/local/bin/kimono
```

On the main VM, `kimono server install` deploys the Kimono Portal plus embedded
Authentik, Headscale, DERP, and Caddy appliance. On every application VM, `kimono node
install` joins that private mesh with a server-minted, single-use service key
and authorizes a per-VM Cloudflare Tunnel. The default policy prevents lateral
VM-to-VM connections. See [`cli/README.md`](cli/README.md) for the full workflow.

Interactive installer:

```bash
curl -fsSL https://raw.githubusercontent.com/kimonoapps/kimono/main/scripts/install.sh | sudo sh
```

## Development identity stack

The supported local Authentik stack lives in `infra/compose/authentik`. Configure
its private `.env` as described there, then run:

```bash
pnpm identity:up
```

The production all-in-one server definition lives in `infra/compose/server`.
It creates the branded Kimono login and Headscale OIDC integration
automatically; `infra/compose/authentik` remains useful for identity-only local
development.
