# Kimono AI (design, replacing Kimono Code)

Status: proposal, 2026-11-05. Nothing built yet.

Kimono AI is one assistant for the whole household. You talk to it; it works on
your files when you let it, and it can build an app and publish it. Code's
machinery (the sandbox node, gVisor, the model gateway, Drive sync, publishing)
stays underneath. What changes is what people see and what the sandbox may reach.

## What people see

- **Chats**, not workspaces. `/ai` on the web (`/code` redirects), and an AI tab
  on the phone. No repositories, branches, pull requests, sandboxes, nodes or
  "turns". Words used: chat, your files, access, app, publish.
- The composer, the timeline of what it did (tool calls open to show their
  output), screenshots, and the app preview carry over from Code.
- **Access cards** in the timeline when it needs files (below).
- **Artifacts** it made show live in the chat, with **Share**.

## What runs where

- Every chat has one sandbox on the node, made on its first message and put to
  sleep as Code's are (pause after 1 min, stop after 15, remove after 7 days;
  files kept). Nobody ever sees it. If the node is down, the chat says
  "Kimono AI is resting. Try again in a moment." and nothing more.
- The agent is Claude Code in the sandbox, with its shell: it reaches for
  `rg`, `jq`, `ffmpeg`, ImageMagick, `exiftool`, `pandoc`, `pdftotext`,
  LibreOffice headless, Python and Node, as a person at a terminal would.

## Never the web

A sandbox reaches the node's gateway (model and Kimono's own file broker) and
nothing else. Code allowed the public internet; Kimono AI does not.

- The sandbox network becomes Docker `--internal` (no default route), and
  `KIMONO-SANDBOX` refuses everything but the gateway address and port, so a
  missing Docker setting still can't open the way out. `--allow-private` and
  `--allow-open-network` go away.
- No DNS: sandboxes get no resolver at all.
- Claude Code runs with `WebFetch` and `WebSearch` disallowed, so it doesn't
  try and fail.
- Tools come in the image, pinned: PDF tools (poppler, qpdf, Ghostscript,
  MuPDF, OCRmyPDF), ImageMagick, ExifTool, ffmpeg, pandoc, LibreOffice
  headless, Tesseract (English, Japanese, French), SQLite, and Python 3.13 with
  pypdf, PyMuPDF, pdfplumber, ReportLab, WeasyPrint, python-docx, openpyxl,
  python-pptx, pandas, matplotlib, Pillow (with HEIC) and more, first on PATH;
  Kimono's artifact libraries and, for
  administrators' server apps, an offline package set (a pip wheelhouse and an
  npm cache of an agreed list).
- The gateway speaks to Anthropic's API (the model) and to the person's own
  Composio session (their apps), each only for that chat's capability; it is
  not a proxy to anywhere else.
- `kimono node sandboxes status` reports "no outside network" per sandbox,
  checked by a probe from inside, and refuses to start sandboxes if the probe
  gets out.

## People's own apps (Composio)

Email, calendar, documents and the rest of a person's own accounts come through
Composio's Tool Router, the way Composio intends it to be used: one session per
person, no code in Kimono for any one toolkit.

- Admin → Applications → Kimono AI takes a **Composio API key** (optional).
- Portal makes each person one Tool Router session (`POST
  /api/v3.1/tool_router/session`, `user_id` = `kimono:<portal host>:<username>`,
  `manage_connections` on, its callback back to Kimono), stores the session id
  and its MCP address, and reuses it. It asks Composio again at most hourly
  whether the session still exists, and makes a new one only if not, or if the
  key changed (`lib/code/composio.ts`, table `tool_sessions`).
- The session goes to the node with each ensure. Claude Code sees one MCP
  server, `composio`, at the node gateway's `/mcp`; the gateway swaps the
  sandbox's capability for the session's key and carries the stream. The
  sandbox never has the key or Composio's address, and still has no web.
- Composio's own tools find the right tool, connect an account (a link the
  agent passes on, and waits for), and run it. Connections belong to the
  person's Composio user, so they last across chats.
- No key, or Composio down: the agent simply has no outside apps that turn.

## Your files, and asking

The agent starts with **no** access to anyone's Drive. It can see the names of
the spaces you are in (so it can ask sensibly) and nothing inside them.

- It asks with a tool, `kimono_request_access { target, need: read | change, why }`.
  Target is a space, folder or file it found by name or that you mentioned.
- The chat shows an access card:

  > **Kimono AI wants to change files in Photos**
  > To sort last week's pictures into folders by day.
  > [Only "IMG_2041.jpg"] [Allow for this chat] [Always allow] [Don't allow]

  "Only …" appears when it asked about one file, or you can pick files from
  a picker. Read and change are asked separately; read is implied by change.
- Granted items appear in the sandbox at `/files/<space>/<path>` (read-only
  for read grants). Changes go back through Drive's own model after each
  step, so versions, the trash and the phone's Files app all see them.
  Deleting moves to Drive's trash and always says so in the timeline.
- **Auto permissions**: in AI settings, per space, "Kimono AI may read" or
  "may read and change" without asking. Always-allow grants are listed there
  and can be taken back; taking one back removes the files from every
  sandbox at once.
- Grants are the person's own: AI can never reach further than its user
  can in Drive, and a shared space's other members are not asked.
- Files you attach to a message are a one-file read grant.

## Artifacts, and apps

What it makes for people is mostly **artifacts**: one self-contained page (a
chore chart, a budget with a chart, a recipe scaler, a photo contact sheet, a
little game). An artifact needs no server and no packages, which suits a
sandbox with no web.

- It writes the artifact as files in the chat's sandbox (`/artifacts/<name>/`,
  an `index.html` and anything beside it) and the chat shows it live in a card,
  in a sandboxed iframe.
- **Libraries come from Kimono, never a CDN.** Portal serves a fixed, pinned set
  at `/ai/lib/…` (React and ReactDOM, Tailwind's runtime, a charting library, a
  Markdown renderer, a date library, Three.js), and the same set is in the
  sandbox at `/opt/kimono/lib` so it can test. The agent is told the list.
- An artifact page is served with `Content-Security-Policy: default-src 'self'
  …; connect-src 'none'`, from its own origin, so it can't reach the web or
  Kimono's API either. It can keep its own state in the browser.
- **Saved to Drive** in an **Artifacts** space, one folder each, so they're on
  the phone and in the Files app.
- **Share**: with the household (a link inside Kimono), or a public link, using
  Drive's links. Changing one later is a message in any chat: "add a column for
  Sam to the chore chart".
- **Apps** with a server (Code's published apps) stay possible for
  administrators, built from the same offline set and published as Code does
  today, with git hidden. They are the exception, not what the AI reaches for.

## Moving from Code

- Existing Code workspaces become chats; their Drive folders stay where they
  are, and each becomes an always-allow grant for its own chat.
- Published apps keep running; their repositories become app history.
- Admin → Applications keeps one entry, renamed Kimono AI, with the same
  settings (node, node key, Claude token; the Kimono Git token is now only
  needed for publishing).

## Build order

1. Network: internal sandbox network, no DNS, web tools off, the probe. Image
   with the file tools and the artifact libraries.
2. Access: grants table, `kimono_request_access` (served by the node's gateway
   as an MCP tool, answered by Portal), access cards, mounting granted files,
   settings page.
3. Chats: the `/ai` UI from Code's, with the words above; `/code` redirect;
   migration.
4. Artifacts: the library set, the artifact card and page, saving to Drive,
   sharing. Then server apps for administrators, git hidden.
5. Phone: the AI tab in the Compose app.

## Open questions

1. **Who uses it.** Proposed: everyone in the household, each with a share of
   the Claude plan (Code's shares), and publishing an app needs an
   administrator's yes (a card in Admin) unless the publisher is one.
2. **Packages with no web.** Settled: artifacts use Kimono's own library set;
   server apps use a fixed offline set baked into the image. No registry
   mirror.
3. **One sandbox per chat or per person.** Per chat keeps chats from seeing
   each other's files; per person is lighter on the node. Proposed: per chat.
