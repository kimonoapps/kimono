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
- Speech is made on the sandbox itself: `kimono-say "<text>" [--voice NAME]
  [--speed N] [-o FILE]` (or `-f TEXTFILE`) reads text aloud with Kokoro, an
  open voice model baked into the image (`/opt/kimono/voice/`), and writes an
  MP3 to `/workspace/media/`. Free and offline: the int8 model, with
  onnxruntime held to the sandbox's CPU quota, speaks about five times faster
  than real time on one CPU (a thread per host core instead runs several times
  slower than real time). Voices in American and British English, Spanish,
  French, Hindi, Italian and Brazilian Portuguese (`--voices`). Kokoro's
  Japanese and Mandarin voices are left out: espeak, its phonemizer here, reads
  kanji as "Chinese letter"; those go to ElevenLabs.

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
  headless, Tesseract (English, Japanese, French), SQLite, the Kokoro voice
  model for `kimono-say`, and Python 3.13 with
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
- **Connections** (in the chat list): the apps a person has connected, from
  their session's toolkits, each with Disconnect (or Connect again when it
  failed), and "Connect an app" to search Composio's toolkits and get a connect
  link from the session. Disconnecting checks the account is in the person's
  own list first. The connect link comes back to Connections.
- Sessions are made without Composio's remote workbench, which would run code
  with the internet on Composio's side.

### Tools with no account (Composio Instant)

Web search, reading pages, maps, weather, market data, speech, video, pictures
and the rest come from Composio's Instant tools: they run on Composio's own
provider accounts and are charged to the Composio balance, so nobody connects
anything. Instant has to be switched on in the Composio project's settings.

- Sessions allow every Instant tool (an empty `instant` policy), web search
  and reading pages included. The sandbox stays offline for a different reason:
  so nothing from the web is downloaded, installed or run there. Searching and
  reading through a tool brings back text, not programs, so it's fine.
- They're called **Pro Tools** wherever people see them, with a lightning
  bolt (`bolt` in both icon sets), and the agent calls them that too.
- A call that ran as a Pro Tool is marked `pro` on its `tool` event when it's
  recorded: Pro Tools are open for the person, they haven't connected that app
  themselves (Composio uses their own account first), and the toolkit has
  Instant tools (`ranAsPro` in `lib/code/media.ts`). Its app logo in the chat
  then wears a bolt filled with the app's accent on its top right, on web and
  phone, in the call's row and in its group's header.
- **Each person's Pro Tools budget** (Admin → Kimono AI, default $20, 0 for none)
  is a monthly allowance in US dollars. Portal sums the person's Instant charges
  this month (UTC) from Composio's execution logs, filtered by their Composio
  user, and keeps their session's `instant` policy to match: `PATCH`ed to
  `false` once spent, back on (`{}`) when a month starts or the budget
  rises (`lib/code/media.ts`, column `tool_sessions.instant`). It checks before
  each turn and again, at most every 15 seconds, after each of their tool calls
  during one. Composio then refuses Instant itself, whatever the agent tries.
  The logs lag a little, so the last call of a month can go slightly over.
  The key must be allowed to read the logs ("observability" read on a scoped
  key). If Composio refuses (401/403), Kimono can't count spending, so it
  closes Instant on the session and tells the agent Pro Tools are unavailable,
  rather than leaving them uncapped.
  Accounts the person connected themselves still work.
- The agent is told each turn what's left, or that it's used up and when it
  returns. The usage panel (web and phone) shows "⚡ Pro Tools".
- Every meter beside Send (context, the 5-hour window, the week, Pro
  Tools) shows only once it's past half; Pro Tools also once the chat has spent
  something (`/api/v1/code/usage?chat=<id>` adds up the person's Instant
  charges made while that chat's turns ran). With none to show, the control
  is gone. The phone's home screen shows the same rows past half.
- The message box's **…** menu (web and phone) always has everything: what it
  may do with your files ("Asks first"), the model and thinking pickers (which
  moved there from the box itself), and every meter whatever its level, with
  Compact beside the context.
- Which one: the system prompt says that anything that must be exact (maths,
  graphs, diagrams, mechanisms, distances) is an artifact even when someone
  says "video", and real video is for when exactness doesn't matter and it
  should look real. Anything read aloud is `kimono-say` (free, no
  allowance); ElevenLabs only for a particular voice, accent or character,
  for Japanese, Mandarin and other languages `kimono-say` lacks, or when someone
  asks for it by name.
- Recommended defaults, not rules (the agent goes past them when a request
  calls for it): real video starts with Veo 3.1 Lite (`GEMINI_GENERATE_VIDEOS`, about 5
  credits a second with sound); Higgsfield, Kling or Runway only when asked
  for by name or for a look Veo can't give. Composio's Seedance 2.5 was about
  46 credits a second. Other tools: 480p unless it's to post or asked sharper,
  no longer than needed, the lighter model version when one does.
- Files come back as links the sandbox can't follow. The node gateway notes
  every https link in a workspace's tool results as they pass, and its
  `/media` fetches one of those links (seen in the last three hours) for
  `kimono-fetch <link> [<name>]`, which saves it under `/workspace/media/`.
  Only pictures, sounds and videos, up to 200 MB, and only from public
  addresses. A link nobody's tool returned is refused, so it isn't a way onto
  the web (`cli/internal/sandbox/media.go`).
- Files go out the same way in reverse. A tool that takes a file by link (a
  photo to animate, a sound to transcribe) gets one from
  `kimono-link <file> [--hours n]`: it copies the file to
  `.kimono/links/<token>/` with its expiry (two hours by default, a day at
  most) and prints `<portal>/api/v1/code/temp/<chat>/<token>/<name>`, the base
  coming to the turn as `KIMONO_LINKS`. The first fetch copies it out of the
  sandbox to the Portal, which serves it to anyone with the link until it
  expires; the 128-bit token is the only key (`lib/code/temp-links.ts`).
- Only projects publish apps. A chat's turns leave out the app-publishing
  part of the system prompt (`AppPrompt`), `kimono-serve` refuses when
  `KIMONO_CHAT=1`, and the node never gives a chat's server a link (and takes
  down one it had). Chats show things as artifacts instead.
- The agent is told to search Composio's tools every time something needs a
  service or the internet, before ever saying it can't: it otherwise answers
  from what it happens to have loaded and refuses things Composio has.

## Your files, and asking

The agent starts with **no** access to anyone's Drive. Each message begins with
a line naming the spaces the person is in and what is open in this chat; it can
see nothing inside a space until it is allowed.

- It asks by running `kimono-access ask --space Photos [--path 2026] --read|--change
  --why "…"` in its sandbox, then ends its turn. The helper leaves the request in
  `/outbox/access`; the node reports it (`kimono.access`) and removes it, so it is
  asked once. Waiting for a person never holds a tool call open.
- Portal finds what it named in the person's Drive (`lib/code/access.ts`). If it
  isn't there, or isn't theirs, the chat says so and nothing opens. If an earlier
  answer already covers it (always, or earlier in this chat), it opens at once and
  the agent is told when its turn ends. Otherwise the chat shows a card:

  > **Kimono AI wants to change files in Photos**
  > To sort last week's pictures into a folder for each day.
  > [Allow for this chat] [Only one file…] [Always allow] [Don't allow]

  "Only one file…" picks one file from inside what it asked for.
- Answering starts the next turn by itself: "They allowed you to read and change
  2026 in Photos, for this chat. It's in /files/Photos/2026." Or that they didn't.
- Allowed files are copied into the sandbox at `/workspace/.kimono/files/<space>/…`,
  which `/files` points to. Git ignores the folder (the checkout adds it to
  `.git/info/exclude`) and Code's own Drive mirror never sees it.
- Files go both ways streamed, never whole in memory, up to 4 GB each. One
  into the sandbox over 50 MB is first checked against the sandbox's disk
  (keeping 256 MB free); one that won't fit, or is over 4 GB, stays in Drive
  and the agent is told its name and why, once per version, so it never
  guesses the file is missing.
- Before each turn the open files follow Drive (the agent is told what changed);
  after each turn, with change, its edits become new versions, new files are
  added, and deleted ones go to Drive's trash, through Drive's own model. With
  read, nothing goes out, and anything it changed is put back from Drive. Both
  sides changing one file: the person's copy wins, the agent's is kept beside it.
- An agent never reaches past its person: in a space they can only view, change
  becomes read, and leaving a space closes it.
- **What Kimono AI can use** (the key button by Tasks): per space, "Asks first",
  "May read" or "May read and change" without asking, and the folders and files
  always allowed, each with "Take back". Taking one back empties every chat's
  sandbox of it at once.
- Security rests on what Portal copies in, never on the sandbox: a request it
  fakes, or an answer it fakes in its own outbox, opens nothing.
- Tables: `access_requests`, `grants` (a chat's, or always when it has no chat),
  `opened` (what a chat has open, and where) and `opened_files` (each file's last
  agreed state). Tests: `pnpm --filter @kimono/portal test:access`.

## Sending files

When the answer is a file (a PDF, a spreadsheet, pictures, a zip), the agent
runs `kimono-send <file>…` (up to 10, 20 MB each). The helper copies them to
`/workspace/.kimono/sent/` and prints one `kimono-sent [...]` line; Portal reads
it from the command's output, copies the files out beside the chat's
attachments and records a `sent` event. Each file is a card in the chat with
its picture or mark, its type and size, and Download; one the file preview can
show (pictures, video, sound, text, Markdown, code) opens over the window.

## Memory and instructions

A Memory page in the chat list holds each person's own instructions and what
Kimono AI remembers about them (`lib/code/memory.ts`). They add, edit and delete
memories; it keeps, changes and forgets them with `kimono-remember` (`--change
ID`, `--forget ID`), and the chat says so. Both reach the node with every turn
as context joined to the system prompt; another person's never do.

## Feedback

Each answer's Done line has a thumbs up and down. A thumb opens a dialog first:
admins can see the answer and the feedback, without the person's name, with room
to say why; nothing is saved until Send. A chat's menu has Report, which warns the
same way and sends the whole chat with an optional reason. Both go to one bank in code.db (`lib/code/feedback.ts`):
a rating keeps a copy of its answer (the ask, what it said, the tools it used and
how they went, the model, how long it took), so the bank stands without the chat;
a report keeps every turn and no name, chat or link back to it. A rating keeps
its person's name only so they can change it. Administrators export the bank
without names from `GET /api/v1/code/feedback` (`?since=<ms>`, `?format=jsonl`)
to read it, or hand it to an AI to look for patterns. Words inside a chat can
still name someone; nothing scrubs them.

## Choosing the model

Auto by default (`lib/code/models.ts`): Opus at medium, every message, so a
chat stays on one model and stays cached. A chip in the
composer picks one instead; picking a different model than the chat has been on
says that it uses more of the plan. The node runs only Fable, Opus, Sonnet or
Haiku; each Done says which answered.

## Projects

A project is a folder of chats, made by anyone. In Drive, a chat's files live
in the person's Code space under its project's name ("Chats" for none), and
moving a chat or renaming a project moves the folder. Every one of a person's
chats may open any of their chats' files without asking: the Code space is
theirs. Work on a Kimono Git repository (administrators) is grouped apart, under
Repositories.

## Artifacts, and apps

What it makes for people is mostly **artifacts**: one self-contained page (a
chore chart, a budget with a chart, a recipe scaler, a little game, or an
animation that explains an idea). An artifact needs no server and no packages,
which suits a sandbox with no web.

- It writes the artifact to `/workspace/artifacts/<name>.html` with its normal
  Write tool, changes it with Edit, and shows it again further down the chat
  with `kimono-show <name>`. The chat turns those calls into an artifact card
  instead of a tool row (`lib/code/artifacts.ts`), and every card shows the
  latest version, which Kimono keeps in `code.db`.
- **It renders while it is written.** The node runs Claude Code with partial
  messages, and Kimono passes a Write's content to the page as it arrives,
  without storing it. The frame writes it into a document that renders as it
  loads, the way a slow page does.
- **One engine, shared** (`packages/artifacts`): the kit (charts, stats,
  tables, tabs, sliders) and the scene engine, the frame that hosts an
  artifact, and its message protocol. Kimono serves it at `/ai/lib/` and
  `/ai/frame`, with three.js and KaTeX pinned beside it; the phone app will
  load the same frame. The agent's reference is `infra/sandbox/artifacts.md`,
  in the sandbox at `/opt/kimono/artifacts.md`, and a test keeps it in step
  with the kit. A SessionStart hook (on startup and after compaction) hands it
  to the agent whole, so no turn spends a step reading it.
- **No web, no Kimono.** The frame is a sandboxed iframe with scripts only, so
  it has no origin, no cookies and no API, and its policy loads nothing but the
  engine and reaches nothing at all. Data goes in the page.
- **Long work as one card.** For something slow (a render, a video being
  generated), the agent runs `kimono-progress "<what>"`, and the card shows
  the job's real progress, never a guess from the clock. kimono-progress keeps
  the card's state in the sandbox at `.kimono/progress.json`: what it's doing,
  running/done/failed, and the job's own status, percent and time left. Work
  that runs in the sandbox starts with `--run "<command>"`: a watcher there
  reads its output (`PROGRESS 35 Drawing frames` lines the agent writes into
  its own scripts, or any `35%` or `120/300`) and ends the card with the
  command, done or failed. `--probe "<command>"` is run every few seconds for
  work measured some other way; a Pro Tool's job is reported by the agent with
  `--status` after each check. `--wait` (at most 100 s, under the tool time
  limit) comes back the moment a `--run` job ends.
  Portal tags kimono-progress calls wherever they sit in a chained command
  (`progress` on the tool event). From a start on, it reads the card's file
  every 2 s (lib/code/progress-probe.ts) and records a `progress` event when
  it changes, so the card moves without the agent; a job the sandbox watches
  is followed after the turn ends too. The bar fills only with a real percent,
  else it's the open wave; steps that were only kimono-progress aren't shown,
  and any others fold under the card. Web and phone read it the same way
  (lib/code/progress-card.ts, and its twin in CodeChat.kt).
- **Any 3D model in a scene.** `model(build, move)` puts the agent's own
  three.js model on a scene's timeline: `build(T)` makes it once, `move()` sets
  it every frame from trackers, so narration, scrubbing and the controls work
  as for any scene. `tag()` labels a part and follows it. `formula()` pins an
  equation to the stage (live when given a function) and `tint()` colours a
  symbol to match its guide on the model.
- **Media and narration.** A page names its own sounds, videos and pictures as
  `media/<file>` (from the sandbox's `/workspace/media/`). When Kimono keeps
  the artifact it copies the files the page names (up to 50 MB each) to
  `<state>/code/media/<chat>/`, and serves them at `/ai/media/<key>/<file>`,
  with byte ranges for seeking. The key is the artifact's own random key: the
  frame has no cookies, so the address is the permission. Only files the
  current page names are served. The frame's policy allows media and images
  from `/ai/media/` and nothing else; the shower sends the address with each
  render (`media`), and the kit points `media/…` there. A scene's
  `narrate(file, text, seconds)` is a step that plays a clip with its words as
  the caption; it lasts the clip's length (corrected once the browser has
  measured it), and play, pause, scrub and replay keep the voice in step.
  `kimono-say --lines script --name n` voices a script line by line and prints
  those steps. A narrated scene reports `voiced`, `muted` and `blocked`, and
  Kimono's controls (web and phone) add a speaker and a volume slider right
  after play, which send `sound-on` / `sound-off` and `volume` (0–1; the web
  remembers it in this browser). Where a browser won't set a page's volume
  (iOS), the kit routes the clip through a Web Audio gain, which is why the
  media route allows CORS. The frame has `allow="autoplay"` (the phone's
  web views play without a tap); where a browser still wants a tap, the switch
  becomes "Tap for sound". Outside Kimono's frame the scene draws its own switch.
- **Scenes** are animations written as code, one statement per line: each line
  plays as soon as it is written. Running the script only describes a
  timeline, so play, pause, scrub and replay are just moving the time; the
  script runs again from the top when it grows, and randomness repeats. They
  have 2D and 3D, sliders and draggable points, calculus (Riemann sums,
  shading, fields, polar and implicit curves), solids of revolution with
  washers and discs, and `$…$` maths.
- **Kimono draws the controls**, never the artifact: under an animation, the
  card has play, pause, a scrubber, the time and a slider for each of the
  scene's parameters, and talks to the scene by message.
- A big artifact opens beside the chat by itself on a wide window; any can go
  full screen.
- Asked for an animation, Kimono picks Opus with light thinking.
- Still to do: saving artifacts to Drive and sharing them, and server apps for
  administrators (built from the same offline set, git hidden).

## Moving from Code

- Existing Code workspaces become chats; their Drive folders stay where they
  are, and each becomes an always-allow grant for its own chat.
- Published apps keep running; their repositories become app history.
- Admin → Applications keeps one entry, renamed Kimono AI, with the same
  settings (node, node key, Claude token; the Kimono Git token is now only
  needed for publishing).

## Build order

1. Network (done): no way out but the gateway, no DNS, web tools off, the probe.
   Image with the file tools (done) and the artifact libraries.
2. Access (done): `kimono-access`, access cards, granted files in and out of
   the sandbox through Drive's model, the settings dialog.
3. Chats (started): a chat needs no project, and shows only its title, the
   conversation and the composer; Files, Changes, App, repositories and pull
   requests appear only for a project or a chat with an app. "Kimono AI" in the
   rail, everyone may chat, projects stay with administrators. Still to do: the
   `/ai` address with `/code` redirecting, and the phone.
4. Artifacts (started): the shared engine and frame, cards that render while
   written, scenes with Kimono's controls, the maths vocabulary, the agent's
   reference. Still to do: saving to Drive, sharing, server apps for
   administrators.
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
