# Kimono

Kimono is a lightweight, self-hosted household application platform. It gives
first-party apps, maintained forks, connected services, and hosted upstream
software one calm launcher and administration surface, with shared identity
where the application supports it.

## Workspace

- `apps/portal` — the household portal and embedded administration area
- `cli` — the single `kimono` binary for the server and connected clients
- `packages/ui` — shared Kimono interface primitives
- `packages/app-sdk` — the platform contract used by Kimono applications
- `docs/decisions` — architectural decisions and their tradeoffs
- `infra/compose` — local infrastructure as it is introduced

## Local development

```bash
pnpm install
pnpm local:dev
```

That one command creates private local environment files when necessary,
generates and synchronizes the Authentik/OIDC secrets, starts the local
Authentik Compose stack, waits for the Kimono OIDC application to be
provisioned, and runs the Portal development server.

- Portal: `http://localhost:3000`
- First-time Authentik setup: `http://localhost:9000/if/flow/initial-setup/`

After creating the initial `akadmin` account, sign into the Portal through the
Kimono-branded Authentik flow.

To erase all local Kimono identity data and start again from an empty database:

```bash
pnpm local:reset
pnpm local:dev
```

`local:reset` removes only the `kimono-identity` containers, network, and named
volumes. It deletes local Authentik users and configuration, but does not touch
other Docker projects or remove downloaded images. `pnpm local:fresh` combines
the reset and restart, while `pnpm local:status` and `pnpm local:logs` provide
the usual diagnostics.

Docker must be usable by the current user. On Linux, either configure rootless
Docker or add the development user to the `docker` group and log in again.

## Install Kimono on VMs

Build the one distributable CLI and install it locally:

```bash
pnpm cli:test
pnpm cli:build
sudo install -m 0755 dist/kimono /usr/local/bin/kimono
```

On the main VM, `kimono server install` deploys the Kimono Portal plus embedded
Authentik, Headscale, DERP, Caddy, application containers, and server-side
tunnel connectors. `kimono node install` only joins a client device to the
private mesh with a server-minted, single-use key. Apps and tunnels are not
scheduled onto client nodes. See
[`cli/README.md`](cli/README.md) for the full workflow.

Interactive installer:

```bash
curl -fsSL https://raw.githubusercontent.com/kimonoapps/kimono/main/scripts/install.sh | sudo sh
```

A running appliance also serves the same script on its portal domain, which is
easier to type on a new device:

```bash
curl -fsSL https://kimono.example.com/install.sh | sudo sh
```

## Development identity stack

The supported local Authentik stack lives in `infra/compose/authentik`. The
normal `pnpm local:dev` command configures and starts it. To run identity alone:

```bash
pnpm identity:up
```

The production all-in-one server definition lives in `infra/compose/server`.
It bootstraps identity, mesh, the Portal, and the reconciler; applications such
as Kimono Notes are deployed from the Portal rather than baked into that file.
`infra/compose/authentik` remains useful for identity-only local development.

Owners and Kimono administrators manage the platform from `/admin` in the
Portal. Nothing in normal administration requires the command line: saving a
change writes a deployment plan, and the reconciler applies it. App domains, launcher visibility, and bloom colors are persisted in the
appliance rather than hard-coded into the frontend.

To expose apps through Cloudflare, open **Admin → Infrastructure → Tunnels → Add
tunnel**. Give the tunnel a name and continue to Cloudflare. After the admin
authorizes a domain through `cloudflared tunnel login`, Kimono creates the
tunnel, isolates its certificate and tunnel credentials, and adds it to every
app's tunnel picker. Repeat the flow to create tunnels in other Cloudflare
accounts. Existing connector tokens remain available as an advanced fallback.

## Deployment

The Portal never talks to Docker. Saving a change in `/admin` renders a
versioned deployment plan into the Portal state directory:

```text
/var/lib/kimono-portal/deployment/
├── plan.json     desired state: Compose project, generated files, DNS routes
├── secrets.env   values for the plan's secret references, 0600
└── status.json   what the reconciler last did, shown back in the Portal
```

The `reconciler` sidecar watches that directory. When the plan changes it
validates it, writes `${KIMONO_HOME}/apps/compose.yaml`, applies the
`kimono-apps` Compose project, installs generated Authentik blueprints so a
connected app gets single sign-on, and creates the Cloudflare DNS record for
each published hostname. It refuses plans that name unexpected images, escape
their project directory, or mount undeclared volumes.

`kimono server apply` runs the same reconciliation once, on demand. It exists
for recovery and debugging; administration does not depend on it.

## Application definitions

Application stacks are file-backed by design. Kimono ships baked definitions
inside the Portal image and then layers administrator definitions from
`/etc/kimono/app-definitions` over them. The Admin application catalog has a
**Rescan files** action and reports invalid definitions without hiding the
error. A filesystem definition with the same ID replaces the baked definition.

Each definition is a directory, not a form-created record:

```text
my-app/
├── app.json
└── icon.svg
```

`app.json` owns the complex stack contract: container images, internal
services, endpoints, persistent volumes, declared environment fields, managed
environment, optional manual setup steps, and default network policy. The
management panel owns only an installed instance: name, enabled state, domain,
flower palette, environment overrides, tunnel selection, and network policy.

`icon.svg` is the app's white center glyph on a transparent `0 0 100 100`
canvas. It must not include the flower. Kimono composes the glyph into the
shared bloom and applies the instance's three configurable colors. Scripts,
event handlers, foreign objects, and external references are rejected.

## Kimono Hosting nodes

See the short [hosting node setup guide](docs/hosting-node-setup.md) to connect
a Wings machine and configure its HTTPS certificate with the Kimono CLI.
