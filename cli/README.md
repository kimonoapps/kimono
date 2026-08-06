# Kimono CLI

Kimono ships as one static Go binary with two roles:

- `kimono server` manages the main control-plane VM.
- `kimono node` joins an application VM and manages its Cloudflare Tunnel.

There is no second agent, central Kimono API, or shared Cloudflare token. The
server runs Authentik and Headscale; each node authenticates directly with
Cloudflare and owns one tunnel.

## Build

```bash
pnpm cli:test
pnpm cli:build
sudo install -m 0755 dist/kimono /usr/local/bin/kimono
```

The executable embeds the complete server appliance definition and Kimono
login artwork. `kimono server install` extracts that private runtime state into
`/var/lib/kimono`; cloning this repository on the server is not required.

Install the latest release and choose the VM role interactively:

```bash
curl -fsSL https://raw.githubusercontent.com/kimonoapps/kimono/main/scripts/install.sh | sudo sh
```

The installer asks whether this is the main server, an application node, or a
CLI-only installation, then collects the required settings. Main-server setup
also asks where the Portal should live: use `@` for the apex domain, a label
such as `www` or `kimono`, or a complete hostname. For unattended
server installation, pass everything in one command:

```bash
curl -fsSL https://raw.githubusercontent.com/kimonoapps/kimono/main/scripts/install.sh | \
  sudo sh -s -- server --domain example.com --email you@example.com
```

The installer detects amd64/arm64, downloads the latest static release, verifies
its SHA-256 checksum, installs `/usr/local/bin/kimono`, and starts the server
appliance. Before starting containers, it discovers the VM's public IPv4 and
checks that both public DNS A records resolve to it. If DNS is wrong, Kimono
saves the generated configuration, prints the mismatch, and waits instead of
starting Caddy with broken certificate prerequisites. Fix DNS and run `sudo
kimono server start` to check again and continue.

## Main server VM

Point two DNS records directly at the VM before installing:

- `accounts.example.com` for Kimono SSO
- `mesh.example.com` for Headscale

The mesh record must be DNS-only when using Cloudflare DNS. Open TCP 80/443 and
UDP 3478, then run:

```bash
sudo kimono server install --domain example.com --email you@example.com
sudo kimono server doctor
sudo kimono server repair
sudo kimono server status
```

Open `https://accounts.example.com/if/flow/initial-setup/` once to create the
owner. The branded Authentik flow then handles Kimono user passwords and MFA.
Application VMs use short-lived service enrollment keys rather than personal
OIDC identities. Server operations are:

```bash
sudo kimono server logs
sudo kimono server backup /safe/location
sudo kimono server update
sudo kimono server stop
sudo kimono server start
```

`server doctor` repeats the public DNS preflight and shows container health.
`server repair` safely restores the embedded appliance files and expected bind
mount permissions without deleting volumes or regenerating secrets. It also
creates and applies the Kimono Authentik blueprint instance explicitly instead
of depending solely on background file discovery.
Forced reconfiguration also preserves all existing persistent secrets; it only
changes the explicitly supplied settings.
Advanced private-network or split-DNS deployments can bypass the guard with
`server start --skip-dns-check`; doing so may prevent public HTTPS certificates
from being issued.

### Cloudflare Dynamic DNS

The interactive main-server installer can configure Dynamic DNS before the
appliance starts. Create a Cloudflare API token from the **Edit zone DNS**
template, restrict it to the Kimono zone, and paste it into the hidden prompt.
For an account-owned token, enter the 32-character Cloudflare Account ID when
prompted; leave it blank for a user-owned token. Kimono verifies each token
against the appropriate Cloudflare endpoint.
Kimono immediately creates or updates the identity and mesh A records as
DNS-only, stores the token at `/var/lib/kimono/cloudflare-ddns.json` with mode
`0600`, and enables a systemd timer that checks every five minutes.

Configure or manage it later with:

```bash
sudo kimono server cloudflare-ddns setup
sudo kimono server cloudflare-ddns run
sudo kimono server cloudflare-ddns status
sudo kimono server cloudflare-ddns remove
```

For unattended setup, put only the token in a root-readable file and use
`setup --token-file /path/to/token --account-id ID --zone example.com`. Omit
`--account-id` for a user-owned token. Do not put API tokens
directly in command arguments or shell history.

## Application VM

First mint a single-use key on the main Kimono VM:

```bash
sudo kimono server enrollment create
```

Then run the same binary on a fresh Ubuntu/Debian VM and paste the key when
prompted:

```bash
sudo kimono node install \
  --server https://mesh.example.com \
  --domain apps.example.com \
  --name kitchen
```

The installer sets up Docker, Tailscale, and cloudflared. The VM joins as an
isolated `tag:kimono-node` service identity; it cannot initiate connections to
other application VMs. cloudflared prints a browser URL so the owner can
authorize that VM's domain. No Cloudflare API token is copied from the main
server.

For a trusted management device, create an administrator key with `sudo kimono
server enrollment create --role admin`. Administrator devices may initiate
connections to application nodes; nodes cannot initiate connections to each
other or to administrators.

Expose a Docker container or a host port:

```bash
docker run -d --name notes my-notes-image
sudo kimono expose notes:3000

sudo kimono expose --name dashboard 8080
kimono list
kimono inspect notes
```

Docker targets are attached to the private `kimono-web` network and reached by
container name. Host ports are reached through Docker's host gateway. One
managed `kimono-cloudflared` container serves every exposure on that VM.

To change a password, use Authentik's account settings. To explicitly replace
the machine login after an account/security change:

```bash
sudo kimono login
```

`kimono logout` removes the current mesh login, while a server administrator
can revoke any device in Headscale. WireGuard itself has keys rather than user
passwords; the Tailscale client plus Headscale and Authentik provide the
Tailscale-like login experience.

## State and diagnostics

Private state defaults to `/var/lib/kimono`. Override it with `KIMONO_HOME` for
testing. `KIMONO_DRY_RUN=1` prints external commands without executing them.

```bash
sudo kimono doctor
sudo kimono status
sudo kimono logs
sudo kimono unexpose notes
```

`unexpose` immediately removes the tunnel ingress rule. The browser-based
Cloudflare authorization does not grant Kimono a reusable API token, so its DNS
record remains visible in the Cloudflare dashboard for manual removal.
