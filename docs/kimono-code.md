# Kimono Code

Coding agents in disposable sandboxes. A **workspace** is one Kimono Git
repository, one branch and one sandbox. You talk to Claude Code in it, browse
its files, read its changes, and open a pull request when it is done.

- **Portal** (`/code`, `apps/portal/src/lib/code`) keeps workspaces,
  conversations and every agent event in `code/code.db`, and streams events to
  the browser. It never runs containers (ADR 0004).
- **`kimono node sandboxes`** (`cli/internal/sandbox`) runs on a hosting node.
  It owns Docker there, runs each sandbox under gVisor, and brokers the model and
  Kimono Git so no real credential enters a sandbox.
- **The sandbox image** (`infra/sandbox`) carries git, Node, Python, Go and
  Claude Code. It holds no credentials.

## Node API

Portal is the only client. Everything is JSON over HTTP on the node's mesh
address (default port `7480`), authenticated with
`Authorization: Bearer <node key>`. Errors are `{ "error": "sentence" }` with a
4xx/5xx status. Workspace ids match `^[a-z0-9-]{1,63}$`.

### `GET /v1/health`
`{ "ok": true, "version": "…", "runtime": "runsc" | "runc" }`

### `PUT /v1/workspaces/{id}` — ensure
Idempotent. Portal calls it before every other workspace call that needs a
running sandbox, so a node restart (which forgets credentials) heals itself.

```json
{
  "repo": { "url": "https://git.example.com/akram/kimono.git", "owner": "akram", "name": "kimono",
            "base": "main", "branch": "code/fix-login-3fa2" },
  "git":  { "token": "<Kimono Git token>", "name": "Akram", "email": "akram@example.com" },
  "model": { "token": "<Anthropic API key or Claude OAuth token>" }
}
```

Creates the container if missing, clones through the broker, creates `branch`
from `base` (or checks it out if it exists on the remote), unpauses a paused
sandbox. Credentials stay in the node's memory only.
Returns `{ "id", "state": "starting" | "ready" | "paused", "branch", "runtime" }`.

### `GET /v1/workspaces/{id}`
`{ "id", "state": "ready" | "paused" | "busy" | "gone", "branch" }`. `gone` = no
container (Portal shows it as asleep and ensures on next use).

### `DELETE /v1/workspaces/{id}`
Removes the container and its volume. `204`. Already gone is fine.

### `POST /v1/workspaces/{id}/turns` — run the agent
```json
{ "prompt": "…", "session": "<claude session id or omitted>", "attachments": ["/attachments/a.png"] }
```
Response is `application/x-ndjson`, streamed until the turn ends. Each line is
one JSON object: Claude Code's own `--output-format stream-json --verbose`
lines passed through untouched, plus Kimono lines:

- `{ "type": "kimono.started", "at": <ms> }` — first line.
- `{ "type": "kimono.stderr", "text": "…" }` — agent stderr, rate-limited.
- `{ "type": "kimono.done", "session": "<id>", "exit": 0, "at": <ms> }` — last
  line, always, including on failure or cancel (`"cancelled": true`).

One turn per workspace at a time; a second gets `409`. Attachments are paths
already uploaded with the attachments call and are named in the prompt by the
node (`Attached files: …`); images among them are also readable by the agent.

### `POST /v1/workspaces/{id}/cancel`
Stops the running turn. `204`.

### `GET /v1/workspaces/{id}/files?path=<dir>`
`{ "path": "src", "entries": [{ "name", "kind": "file" | "dir" | "link", "size" }] }`
Paths are relative to the repository root; `..` and absolute paths are
refused. `.git` is hidden. Dirs first, then by name.

### `GET /v1/workspaces/{id}/file?path=<file>`
Raw bytes, `Content-Type: application/octet-stream`, at most 2 MB (`413` past
that).

### `PUT /v1/workspaces/{id}/attachments?name=<file name>`
Raw body, at most 20 MB. Stored at `/attachments/<name>` in the sandbox,
outside the repository. Returns `{ "path": "/attachments/<name>" }`.

### `GET /v1/workspaces/{id}/changes`
Everything on the branch against `base`, committed or not, untracked included:
```json
{ "base": "main", "branch": "code/…",
  "files": [{ "path", "status": "added" | "modified" | "deleted" | "renamed", "additions", "deletions" }],
  "diff": "<unified diff, truncated at 1 MB>", "truncated": false }
```

### `POST /v1/workspaces/{id}/publish`
`{ "title": "…", "body": "…" }` — commits anything uncommitted (message =
title), pushes the branch, and opens a pull request into `base`, or returns the
open one. `{ "url", "number" }`.

## Screenshots and previews

Code is for people who don't read diffs, so the agent shows its work: it takes
screenshots of what it built, and it can run the app and hand back a link that
anyone with it can open.

**In the sandbox** (on `PATH`, documented to the agent in the system prompt the
node appends to every turn):

- `kimono-shot <url-or-file> [caption]` — a URL is opened in headless Chromium
  at 1280×800 and captured (`--mobile` for 390×844, `--full` for the full page);
  a file is copied as is. The picture lands in `/outbox/shots/`.
- `kimono-serve <port> -- <command…>` — starts the command detached (it outlives
  the turn) with `HOST=0.0.0.0` and `PORT` set, waits up to two minutes until
  the port answers, and publishes it. Logs go to `/outbox/serve.log`. Running it
  again replaces the previous one and keeps the same link.
- `kimono-unserve` — stops it and takes the link down.

**On the stream**, the node adds lines as these happen:

- `{ "type": "kimono.image", "name": "<file>", "caption": "…" }`
- `{ "type": "kimono.preview", "url": "https://…", "port": 3000 }`
- `{ "type": "kimono.preview.stopped" }`

**Node API additions**

- `GET /v1/workspaces/{id}/outbox/{name}` — a screenshot's bytes (PNG/JPEG/WebP, ≤ 10 MB).
- `GET /v1/workspaces/{id}/preview` — `{ "url", "port", "state": "live" | "down" }`, or `404` when there is none.
- `DELETE /v1/workspaces/{id}/preview` — stops the server and takes the link down. `204`.
- The ensure and state answers carry `"preview": { "url", "port" } | null`.

**How a preview is reached — one DNS record, ever.** `kimono node sandboxes
enable --preview-domain example.dev` gives the node its own Cloudflare tunnel
whose only rule sends everything to the node's preview proxy, and creates a
single wildcard record, `*.example.dev`, pointing at it. That is the only DNS
change previews ever make: a new link is just a name the proxy starts
answering for (`<words>-<6 hex>.example.dev`), and taking one down only stops
answering. The wildcard is first-level, so Cloudflare's free universal
certificate covers it.

Use a domain of its own for previews if you can (any cheap one). A preview runs
whatever the agent wrote, and on a separate registrable domain it can't set
cookies for Kimono's. On Kimono's own domain the wildcard still works — records
Kimono already has keep winning over it — but it's the less isolated choice.

The proxy reaches an app on the sandbox's own address when it listens on all
interfaces, and otherwise (an app bound to `localhost`, or Docker running in a
VM as on macOS) through the sandbox itself, with `socat`. WebSockets pass
through either way, so dev servers' live reload works.

Without a preview domain (or in development) the proxy listens on
`127.0.0.1:7482` and links are `http://<name>.localhost:7482`.

Taking a preview down, or deleting the workspace, makes the proxy stop
answering for its name. Previews survive a node restart: the node keeps them in
its state directory. A sandbox with a live preview sleeps like any other (see
"Sleep" below); opening its link wakes it.

## Code in Drive

Every task's files are in Drive, so they show up wherever Drive does — the web,
the phone, and the Files app on iPhone and Android.

- Each person gets a **Code** space (made the first time they use Code, and
  made again if they delete it). Inside: a folder per project, and in it a
  folder per task, holding the task's files as they are in its sandbox. The
  agent's screenshots go in the task's **Screenshots** folder.
- **Sandbox → Drive** after every turn, after publishing, and when the Files
  tab opens: new files are added, changed ones become a new version of the
  same file, removed ones go to Drive's trash. Ignored files (by
  `.gitignore`), `.git`, files over 50 MB and anything past 5,000 files stay
  out.
- **Drive → sandbox** before every turn and when the Files tab opens: what a
  person added, edited or deleted in the task folder goes into the sandbox,
  and the agent's next turn begins "Changed in Drive since last time: …".
  If both changed the same file, Drive's copy wins and the agent's is kept
  beside it as `<name> (agent).<ext>`.
- Everything goes through Drive's own model, so versions, the trash and the
  change feed the Files app syncs from all apply as they would to any file.
- **From Drive** in the composer copies files from any space you can see
  into the task folder and attaches them to the message. **Open in Drive** in
  a task's header goes to its folder. Deleting a task leaves its folder.
- Node calls used: `GET /v1/workspaces/{id}/tree` (`{ files: [{ path, size,
  sha1 }], truncated }`), `GET …/file?full=1&path=` (up to 50 MB), `PUT
  …/file?path=` and `DELETE …/file?path=`. Portal API for the phone: workspace
  JSON carries `drive: { spaceId, folderId } | null`; `POST
  /api/v1/code/workspaces/{id}/from-drive { nodes: [ids] }` answers `{
  attachments }`.

## Inside a sandbox

- Repository at `/workspace`, attachments at `/attachments`, user `agent`
  (uid 1000), no Docker socket, CPU/memory/pid limits, gVisor where installed.
- `ANTHROPIC_BASE_URL` points at the node's model gateway and the agent's key is
  a per-workspace capability. The gateway swaps it for the real credential.
- `git` reaches Kimono Git only through the node's broker (`url.insteadOf` and
  an extra header carrying the capability). The broker allows smart-HTTP for the
  workspace's own repository and nothing else.

## Network

A sandbox reaches the public internet and the node's gateway port (`7481`, the
model gateway and Git broker), and nothing else: not the node's other ports
(the API, the preview proxy, SSH), not the LAN, not the Kimono mesh, not other
sandboxes, not cloud metadata.

- The sandbox network is a bridge with inter-container traffic off and IPv6
  off. Sandboxes resolve names through public resolvers (`--dns`, default
  `1.1.1.1,9.9.9.9`), since a LAN resolver is out of their reach.
- The node keeps two iptables chains of its own, entered only by traffic from
  the sandbox subnet:
  - `DOCKER-USER → KIMONO-SANDBOX` — what a sandbox sends through the node.
    Replies pass; `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (the mesh),
    `127.0.0.0/8`, `169.254.0.0/16` (metadata), `172.16.0.0/12`,
    `192.168.0.0/16`, `224.0.0.0/4` and `240.0.0.0/4` are refused; everything
    else carries on to Docker's own rules and NAT.
  - `INPUT → KIMONO-SANDBOX-IN` — what a sandbox sends to the node itself, on
    any of its addresses. Replies pass, the gateway port on the gateway address
    passes, everything else is refused.
- The rules are put in place when the node starts, rebuilt from scratch each
  time (so a restart never duplicates them), and a missing jump is restored
  before any sandbox starts. `disable` removes them.
  `kimono node sandboxes status` says whether they are in place.
- `--allow-private CIDR` (repeatable, on `enable` or `serve`) lets sandboxes
  reach one private network anyway, such as a LAN package mirror.
- Without `iptables` the node refuses to run sandboxes. `--allow-open-network`
  runs them without the firewall, for development only. On macOS (Docker
  Desktop) the firewall isn't applied, and the node says so when it starts.

## Sleep

An idle sandbox costs next to nothing. Activity is a running turn, any API call
for the workspace (except asking its state or its preview's state), the agent
using the model or Kimono Git, or a request through its preview. After
`--pause-after` of no activity (default 1 minute) the container is paused —
frozen in memory, resumed instantly. After `--stop-after` (15 minutes) it is
stopped, freeing its memory. After `--remove-after` (7 days; `0` never) the
container is removed; its files stay on its volume. A running turn is never put
to sleep.

Anything that needs the sandbox wakes it: ensure and every workspace call
unpause, start, or make the container again on the same volume. A preview's app
is started again with it. Through the preview proxy, a paused sandbox thaws
before the request is answered; a stopped or removed one is started while the
browser waits up to 1.5 s (20 s for a WebSocket upgrade), after which it gets a
small "Waking up…" page (`503`, `Retry-After: 2`) that refreshes itself every two
seconds until the app answers.

The state answers say `ready`, `busy`, `paused`, `stopped` (stopped or removed,
files kept) or `gone`. Each sandbox's last activity and repository (never a
credential) is kept in `<state-dir>/sandboxes.json`, so a restarted node neither
wakes everything nor forgets what is overdue: it sleeps overdue sandboxes as it
starts. `kimono node sandboxes status` lists every sandbox with its state and
how long it has been quiet.

## Set up a node

On a Linux hosting node with Docker that has joined the Kimono mesh:

```bash
sudo kimono node sandboxes enable
```

This installs gVisor and registers it with Docker as `runsc`, keeping every other
setting in `/etc/docker/daemon.json`. It makes a node key at
`/etc/kimono/sandboxes.key`, pulls the sandbox image, and starts the
`kimono-sandboxes` service on the node's mesh address, port `7480`. Last, it
prints the sandbox address and key to enter in Kimono Code's settings. Pass
`--listen` to use another address.

- `kimono node sandboxes status`: the service, and every sandbox with its repository.
- `sudo kimono node sandboxes disable`: stops the service; `--remove` also deletes the sandboxes.

Each sandbox reaches the node's gateway on the sandbox network's gateway
address, port `7481`; the node's own firewall rules (see Network) allow exactly
that. If the host runs another firewall, it must let the `kimono-sandboxes`
bridge reach that port too. `enable` needs `iptables` installed.

For development, `serve --dev-git-dir DIR` serves the bare repositories in
`DIR` as `http://dev.git/OWNER/NAME.git`, and also lets the node reach a Kimono
Git on this machine over plain HTTP (`http://localhost:PORT`), such as a
throwaway Forgejo container. `KIMONO_SANDBOX_AGENT`
replaces the command a turn runs. Neither belongs on a real node.

## Switch it on in Portal

In Admin → Applications, switch on **Kimono Code** (Kimono Git must be on too)
and fill in:

| Setting | Value |
| --- | --- |
| Sandbox node | the address `enable` printed, e.g. `http://100.64.0.7:7480` |
| Node key | the key `enable` printed |
| Kimono Git token | a Kimono Git access token with repository read and write |
| Claude token | an Anthropic API key, or what `claude setup-token` prints |

Code then appears at `/code` for administrators. The tokens go to the node with
each ensure and live only in its memory; no sandbox ever holds them.

## Try it on one machine

1. Run a throwaway Forgejo (`codeberg.org/forgejo/forgejo`) on a local port,
   make a user, a token and a repository.
2. Build the image (`docker build -t ghcr.io/kimonoapps/kimono-sandbox:dev infra/sandbox`)
   and run `kimono node sandboxes serve --listen 127.0.0.1:7480 --key-file KEY
   --image ghcr.io/kimonoapps/kimono-sandbox:dev --dev-git-dir DIR`, with
   `KIMONO_SANDBOX_AGENT` set to a fake agent if you don't want to spend tokens.
3. In the Portal's settings, point Code at `http://127.0.0.1:7480` and set
   *Kimono Git address* (advanced) to the Forgejo's `http://localhost:PORT`.

`pnpm --filter @kimono/portal test:code` covers the timeline, turns and the
translation of Claude Code's stream; `go test ./cli/internal/sandbox` covers
the node.

## Phone

The Kimono phone app (`apps/compose`) has Code too, for administrators: a card
on Home opens the workspaces (`screens/Code.kt`, `data/Code.kt`). It uses the
same `/api/v1/code` endpoints with its bearer token. Instead of holding a stream
open it asks for `events?after=<seq>` (JSON) every second while the agent works
and every five seconds otherwise, only while the screen is in front.
Attachments come from the system file picker. Screenshots show as a gallery (tap for full
screen, swipe between them), and a running app gets a card with Open, Share
(the system share sheet) and Take down, plus an Open app action in the
workspace's header.
