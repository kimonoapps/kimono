# Kimono server

This Compose project runs the private-network control plane for Kimono:

- Authentik provides Kimono SSO.
- Kimono Portal provides the household application home screen.
- Kimono Notes provides shared notes through Outline with Kimono SSO.
- Kimono Photos provides the household photo library through Immich with Kimono SSO.
- Headscale coordinates the WireGuard mesh and enrolls devices through OIDC.
- Headscale's embedded DERP/STUN service relays encrypted traffic when peers
  cannot connect directly.
- Caddy terminates public TLS for identity, mesh, Portal, and Notes.

Application exposure belongs to the Kimono server runtime, not connected client
nodes. The Portal manages provider connections and route intent; client-node
exposure commands remain optional convenience tools.

## Requirements

- A Linux VM with Docker Engine and Docker Compose v2
- Public TCP ports 80 and 443
- Public UDP port 3478
- Four DNS records pointing directly to the VM, for example:

  - `accounts.example.com`
  - `mesh.example.com`
  - `kimono.example.com` (or an apex/hostname chosen during setup)
  - `notes.example.com`

The mesh record must be DNS-only. Do not place Headscale behind a Cloudflare
Tunnel or enable Cloudflare's HTTP proxy for this record; the Tailscale control
protocol uses an HTTP POST upgrade that Cloudflare does not proxy correctly.

`kimono server install` verifies all four A records against the VM's detected public
IPv4 before starting the appliance. It leaves generated configuration in place
when DNS is not ready; correct the records and run `sudo kimono server start`.
Use `sudo kimono server doctor` to repeat the check later.

For dynamic public IPs, run `sudo kimono server cloudflare-ddns setup` and use a
zone-scoped Cloudflare **Edit zone DNS** API token. Kimono manages all four A
records as DNS-only and installs a five-minute systemd timer. The
token is stored root-only outside the Compose environment file.

## Configure

Create the private environment file:

```bash
cp infra/compose/server/.env.example infra/compose/server/.env
openssl rand -base64 36
openssl rand -base64 60
openssl rand -hex 32 # repeat for each remaining OIDC, database, and app secret
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

Authentik discovers the mounted `Kimono Platform` blueprint and creates its
OIDC providers automatically. The same blueprint creates an exact-domain Kimono
Brand and a dedicated authentication flow that reuses Authentik's maintained
identification, password, MFA, and session-login stages. The login experience
uses the Kimono SVG wordmark, botanical artwork, paper palette, and responsive
left-content composition without replacing Authentik's security components.

The Headscale container waits for Authentik's health check and then validates
OIDC discovery before accepting clients.

Brand styling lives in:

```text
infra/compose/server/authentik/blueprints/kimono.css
```

The wordmark and botanical background are reusable SVG assets served directly
by Caddy from the Portal brand directory. Authentik reapplies the blueprint
automatically when the YAML or CSS changes.

## Invite someone

Authentik ships no enrollment flow of its own, so the mounted `Kimono
Enrollment` blueprint provides one: `Kimono - Invitation enrollment`. Without
it the invitation screen has no flow to offer and the invitation it creates
redeems into nothing.

An appliance installed before this blueprint existed picks it up with:

```bash
sudo kimono update
```

In the Portal, **Admin → Useful links → Invite someone**, or directly:

```text
https://<AUTHENTIK_DOMAIN>/if/admin/#/flow/stages/invitations
```

Create the invitation with **Flow** set to `Kimono - Invitation enrollment`,
then send the person the link it shows:

```text
https://<AUTHENTIK_DOMAIN>/if/flow/kimono-invitation-enrollment/?itoken=<token>
```

They give a name, username, email, and a password of their own, and land signed
in. Custom attributes on the invitation named `name`, `username`, or `email`
pre-fill those fields.

The flow refuses to run without a valid invitation, and the brand deliberately
sets no enrollment flow, so the sign-in page offers no self-signup. A new
account joins no group: grant Kimono VPN per person from the Portal.

## Kimono Notes

Kimono Notes is Outline, deployed as a connected Kimono application from the
Portal rather than from this Compose file. Enabling it in `/admin` renders a
deployment plan; the `reconciler` sidecar then starts its web service,
PostgreSQL database, Redis instance, and upload volume in the `kimono-apps`
project, installs the generated Authentik blueprint that creates its OIDC
provider, and creates the DNS record for its hostname. Its hostname and
launcher palette are Admin settings; changing them does not require rebuilding
any image.

After signing in as an owner or Kimono administrator, open `/admin`. The Admin
surface stores the base domain, per-app domain, launcher visibility, and flower
palettes under `/var/lib/kimono-portal`, which is backed up as a directory. Short app names are resolved
under the configured base domain; complete hostnames remain unchanged.

On first launch, choose **Continue with Kimono**. The first authenticated user
creates the Outline workspace and becomes its administrator. Outline remains
responsible for note permissions and workspace administration.

## Kimono Photos

Kimono Photos is Immich, deployed as a connected Kimono application the same way
Kimono Notes is. Enabling it in `/admin` starts its server, machine-learning
worker, PostgreSQL database, Valkey instance, and library volume in the
`kimono-apps` project.

Immich reads neither single sign-on nor its other settings from the environment.
It takes one JSON document instead, so Kimono renders that document from the
deployment plan and mounts it read-only at `/etc/immich/config.json`. Its OIDC
provider, external domain, and machine-learning address are derived and follow
the app's hostname; everything a household would want to change lives under
**Admin → Photos → Settings**: sign-in behaviour, the trash window, machine
learning, video conversion, preview quality, and SMTP.

Because Immich treats that document as the whole of its system configuration,
its own **Administration → Settings** screens are read-only. The Kimono page is
the editor. Anything neither page sets stays at the Immich default, and adding a
knob means adding a field to the app definition rather than changing code.

Mobile apps sign in through the same provider. Kimono registers
`app.immich:///oauth-callback` alongside the two web redirect URIs, so the iOS
and Android clients can use **Sign in with Kimono** without further setup.

## Cloudflare Tunnel connection

Sign in as an owner or Kimono administrator, then open **Admin → Infrastructure
→ Tunnels → Add tunnel**. Give the connection a name and Cloudflare domain.
Kimono runs `cloudflared tunnel login`, opens Cloudflare's authorization page,
waits for `cert.pem`, and creates the named tunnel automatically. The production
Portal image includes `cloudflared`; local development uses the official
Cloudflare Docker image when no local binary is installed.

Every login uses a separate private directory in the backed-up Portal
configuration volume. Its account-wide certificate and tunnel-specific
credentials therefore cannot overwrite another Kimono tunnel. Repeat the flow
to create a tunnel in another Cloudflare account.

The domain selected during authorization becomes the domain dropdown for that
tunnel. In an app's **Setup** page, select a tunnel and edit only the subdomain.
Setup is the only place that owns the app
address; Infrastructure shows generated routes without a second hostname
editor. Existing connector tokens and
locally managed tunnel credentials remain available as advanced fallbacks. The
server-runtime screen previews the generated Compose project and route actions
before deployment.

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
- `/var/lib/kimono-portal` (Portal settings, secrets, and tunnel credentials)
- every `kimono-apps_*` volume belonging to a deployed application

Pin updates by changing `AUTHENTIK_TAG`, `HEADSCALE_TAG`, or `CADDY_TAG` in
`.env`; application versions come from their definitions. Read upstream migration notes before updating Headscale across releases,
and test service enrollment and peer isolation after every update.
