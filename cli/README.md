# Kimono CLI

Kimono ships as one static Go binary with two roles:

- `kimono server` manages the main control-plane VM.
- `kimono node` joins a client device to the Kimono private mesh.

The Portal is the desired-state control plane for apps, routes, and server-side
tunnel instances. Client nodes do not run application containers or own
tunnels. Cloudflare is the first installed tunnel provider, not a client-node
assumption.

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

The installer asks whether this is the main server, a client node, or a
CLI-only installation, then collects the required settings. Main-server setup
asks for one base domain and short names for Portal and Notes. A name such as
`family` becomes `family.<base-domain>`, `@` uses the base itself, and a full
hostname is left unchanged. For unattended
server installation, pass everything in one command:

```bash
curl -fsSL https://raw.githubusercontent.com/kimonoapps/kimono/main/scripts/install.sh | \
  sudo sh -s -- server --domain example.com --email you@example.com
```

The installer detects amd64/arm64, downloads the latest static release, verifies
its SHA-256 checksum, installs `/usr/local/bin/kimono`, and starts the server
appliance. Before starting containers, it discovers the VM's public IPv4 and
checks that all four public DNS A records resolve to it. If DNS is wrong, Kimono
saves the generated configuration, prints the mismatch, and waits instead of
starting Caddy with broken certificate prerequisites. Fix DNS and run `sudo
kimono server start` to check again and continue.

## Main server VM

Point four DNS records directly at the VM before installing:

- `accounts.example.com` for Kimono SSO
- `mesh.example.com` for Headscale
- `kimono.example.com` for the Portal
- `notes.example.com` for Kimono Notes

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
Client nodes use short-lived enrollment keys. Server operations are:

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
Kimono immediately creates or updates the identity, mesh, Portal, and Notes A records as
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

## Client node

First mint a single-use key on the main Kimono VM:

```bash
sudo kimono server enrollment create
```

Then run the same binary on the client and paste the key when prompted:

```bash
sudo kimono node install \
  --server https://mesh.example.com \
  --name kitchen
```

The installer sets up Tailscale and joins the client to Headscale. It does not
install Docker or cloudflared. Application stacks, databases, tunnel
connectors, and route reconciliation remain on the Kimono server.

### Pelican Wings TLS

Pelican node creation remains manual: create the node in Kimono Hosting first,
choose HTTPS and its public port (normally `8080`), then install the Wings
configuration Pelican generates. Kimono can prepare and renew the trusted
certificate on the node without using port 443. Point the node hostname at its
public IP with a DNS-only record before setup.

When TCP port 80 reaches the node, use Let's Encrypt's HTTP challenge:

```bash
sudo kimono node hosting tls \
  --hostname node1.example.com \
  --email you@example.com
```

Keep port 80 reachable for renewals and forward the configured Wings port
(normally TCP 8080). The resulting endpoint is
`https://node1.example.com:8080`; port 443 is not used.

If port 80 cannot reach the node, create a Cloudflare API token restricted to
DNS edits for the zone and put only its value in a root-readable file:

```bash
sudo install -m 0600 /dev/null /root/cloudflare-dns-token
sudo nano /root/cloudflare-dns-token
sudo kimono node hosting tls \
  --hostname node1.example.com \
  --email you@example.com \
  --challenge cloudflare \
  --cloudflare-token-file /root/cloudflare-dns-token
```

DNS validation requires no inbound validation port. Both modes install a
Certbot deployment hook that restarts Wings after a successful renewal. The
command prints the `fullchain.pem` and `privkey.pem` paths expected by Wings.

As a separate convenience, a client may publish something local. The first
`node expose` lazily installs Docker/cloudflared, asks for a Cloudflare domain,
and creates a client-owned convenience tunnel:

```bash
sudo kimono node expose --domain personal.example.com notes:3000
sudo kimono node expose --name dashboard 8080
kimono node list
```

These exposures never become Kimono applications, do not appear in the app
catalog, and have no relationship to server-side app placement or tunnels.

For a trusted management device, create an administrator key with `sudo kimono
server enrollment create --role admin`. Administrator devices may initiate
connections to ordinary client nodes; ordinary nodes cannot initiate connections to each
other or to administrators.

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
sudo kimono node doctor
sudo kimono node status
sudo kimono node logs # only for the optional convenience tunnel
```
