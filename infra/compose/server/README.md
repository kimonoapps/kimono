# Kimono server

This Compose project runs the private-network control plane for Kimono:

- Authentik provides Kimono SSO.
- Kimono Portal provides the household application home screen.
- Headscale coordinates the WireGuard mesh and enrolls devices through OIDC.
- Headscale's embedded DERP/STUN service relays encrypted traffic when peers
  cannot connect directly.
- Caddy terminates public TLS for the identity and mesh endpoints.

It does **not** manage application exposure on connected VMs. Each VM owns its
own Cloudflare login and Cloudflare Tunnel through the Kimono CLI.

## Requirements

- A Linux VM with Docker Engine and Docker Compose v2
- Public TCP ports 80 and 443
- Public UDP port 3478
- Three DNS records pointing directly to the VM, for example:

  - `accounts.example.com`
  - `mesh.example.com`
  - `kimono.example.com` (or an apex/hostname chosen during setup)

The mesh record must be DNS-only. Do not place Headscale behind a Cloudflare
Tunnel or enable Cloudflare's HTTP proxy for this record; the Tailscale control
protocol uses an HTTP POST upgrade that Cloudflare does not proxy correctly.

`kimono server install` verifies both A records against the VM's detected public
IPv4 before starting the appliance. It leaves generated configuration in place
when DNS is not ready; correct the records and run `sudo kimono server start`.
Use `sudo kimono server doctor` to repeat the check later.

For dynamic public IPs, run `sudo kimono server cloudflare-ddns setup` and use a
zone-scoped Cloudflare **Edit zone DNS** API token. Kimono manages the identity
and mesh A records as DNS-only and installs a five-minute systemd timer. The
token is stored root-only outside the Compose environment file.

## Configure

Create the private environment file:

```bash
cp infra/compose/server/.env.example infra/compose/server/.env
openssl rand -base64 36
openssl rand -base64 60
openssl rand -hex 32
```

Use those values for `PG_PASS`, `AUTHENTIK_SECRET_KEY`, and
`KIMONO_HEADSCALE_OIDC_CLIENT_SECRET`. Then set:

- `AUTHENTIK_DOMAIN` to the public identity hostname.
- `MESH_DOMAIN` to the public Headscale hostname.
- `MAGIC_DNS_DOMAIN` to a separate private suffix used for enrolled devices.
- `ACME_EMAIL` to the address used for certificate notices.
- `KIMONO_HEADSCALE_OIDC_REDIRECT_URI` to
  `https://<MESH_DOMAIN>/oidc/callback`.
- `KIMONO_HEADSCALE_OIDC_ISSUER` to
  `https://<AUTHENTIK_DOMAIN>/application/o/kimono-headscale/`.

The redirect and issuer values are explicit instead of being silently derived,
which makes domain mistakes visible during Compose validation.

Check the rendered project before starting it:

```bash
pnpm server:config
```

## Start and bootstrap

```bash
pnpm server:up
```

Open the following URL and create the initial Kimono owner:

```text
https://<AUTHENTIK_DOMAIN>/if/flow/initial-setup/
```

Authentik discovers the mounted `Kimono Headscale` blueprint and creates its
OIDC provider automatically. The same blueprint creates an exact-domain Kimono
Brand and a dedicated authentication flow that reuses Authentik's maintained
identification, password, MFA, and session-login stages. The login experience
uses the Portal's sakura mark, branch artwork, paper palette, and responsive
left-content composition without replacing Authentik's security components.

The Headscale container waits for Authentik's health check and then validates
OIDC discovery before accepting clients.

Brand styling lives in:

```text
infra/compose/server/authentik/blueprints/kimono.css
```

The logo and branch are served directly by Caddy from the existing Portal
assets, so there is only one checked-in copy of each artwork file. Authentik
reapplies the blueprint automatically when the YAML or CSS changes.

Inspect service state and logs with:

```bash
docker compose --env-file infra/compose/server/.env \
  -f infra/compose/server/compose.yml ps

pnpm server:logs
```

## Enroll an application VM

Mint a short-lived, single-use key on the Kimono server:

```bash
sudo kimono server enrollment create
```

Install the same Kimono binary on the application VM, then run and paste the
key when prompted:

```bash
sudo kimono node install \
  --server https://mesh.example.com \
  --domain apps.example.com \
  --name kitchen
```

Paste that key into `kimono node install` when prompted. The command installs
Docker, Tailscale, and cloudflared. The browser URL authorizes the Cloudflare
account for this VM's own tunnel. The node reconnects after reboots without
storing the enrollment key.

For unattended provisioning, provide the key only to the provisioning process
and ensure the command is not recorded in shell history or process logs:

```bash
sudo kimono server enrollment create --expiration 10m
sudo kimono node install --auth-key '<ONE_TIME_KEY>' \
  --server https://mesh.example.com --domain apps.example.com --name kitchen
```

Treat the key as a secret. It expires quickly, works once, and is redacted from
Kimono command errors and dry-run output.

## Access policy

The initial policy in `headscale/policy.hujson` is default-deny. Application VMs
join with `tag:kimono-node`; they cannot initiate connections to sibling VMs or
administrator devices. Cloudflare Tunnels continue to work because they use
outbound internet connections rather than peer mesh access.

To enroll a trusted management machine, mint an administrator key:

```bash
sudo kimono server enrollment create --role admin
```

A device enrolled with `tag:kimono-admin` may initiate connections to Kimono
nodes. Only the server-side command can mint these privileged keys. Return
traffic for administrator-initiated connections is allowed, but ordinary nodes
receive no rule permitting them to initiate lateral traffic.

Existing VMs enrolled through OIDC are personal nodes. After upgrading to this
policy they are isolated, but should be migrated to a service identity by
running `sudo kimono node login` and entering a fresh node enrollment key.

`HEADSCALE_NODE_EXPIRY` defaults to `180d`. Set it to `0` if nodes should never
require browser reauthentication; owners can still revoke a device immediately.

## Backups and upgrades

Back up these named volumes:

- `kimono-server_authentik_database`
- `kimono-server_authentik_data`
- `kimono-server_headscale_data`
- `kimono-server_caddy_data`

Pin updates by changing `AUTHENTIK_TAG`, `HEADSCALE_TAG`, or `CADDY_TAG` in
`.env`. Read upstream migration notes before updating Headscale across releases,
and test service enrollment and peer isolation after every update.
