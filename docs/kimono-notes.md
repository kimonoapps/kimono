# Kimono Notes (design, replacing Outline)

Status: the server is built (2026-11-07); web, phone and `/mcp` are next.

Notes is where a household writes things down: groceries, the Wi-Fi password
for guests, a trip plan, a recipe. It is Kimono's own app now. Outline is gone.

## What it is underneath

Notes has no store of its own. **A notebook is a Drive folder marked as a
notebook**, in any space. Folders in it are **sections** and every `.md` file is
a **note**. The note's title is its file name without `.md`. So the same notes
show in Drive, in the Files app on iPhone and Android, in Kimono AI, and in
anything that reads Markdown. Drive's rules decide who may read or change them.

- **Drive shows a notebook as a notebook**, with its own mark and the word
  "Notebook", and opening one goes to Notes (`/notes?notebook=<id>`). Its menu
  still has **Show files**. Kimono AI's chats are marked the same way: each
  shows as a chat and opens in Kimono AI, and its project shows as a project.
  The mark is Drive's folder `purpose` (`notebook`, `chat`, `project`), with
  `ref` naming the chat. The app the folder belongs to sets it; people never
  do.
- **A notebook is shared with whoever is in its space.** One in Family is
  Family's. **Share** adds people outside the space to just that notebook, or
  to just one note, as editors or viewers. It stays where it is. This uses
  Drive's shares (`shares` table, migration 8), which work for any folder or
  file:
  - anyone who may edit it may share it, change someone's access, or take
    someone off; anyone may leave;
  - for the people it's shared with, it shows under **Shared with you** in
    Notes, in Drive and in the Files app, standing on its own; they never see
    the rest of the space, its name or its members;
  - someone who has it only through a share can't delete it; they leave it;
  - a note inside a shared notebook shows who has it through the notebook.
- **Public link:** a notebook or a note can have a read-only link that works
  without signing in, at `/n/<token>`. The admin's Drive switch for public
  links turns these off too. The page shows the notes typeset, and nothing
  about who wrote them or where they live.
- Someone with no notebook gets **Notes** the first time they open the app or
  Kimono AI needs one. It goes in their own space: the oldest one they own with
  nobody else in it, or a new **Personal** space if they have none. **New
  notebook** asks which space it goes in, and defaults to that one.
- A notebook never holds another: one moved inside another becomes a section.
- Saving goes through Drive's upload bookkeeping, so the change log, the Files
  app and conflict handling all work as they do for any file. A save names the
  `version` it was edited from. If someone else saved first, theirs stays and
  yours is kept beside it as `… (edited elsewhere).md`.
- Deleting puts the note in Drive's trash for 30 days.

API: `/api/v1/notes` (code: `apps/portal/src/lib/notes`, `src/app/api/v1/notes`).

| | |
|---|---|
| `GET /notes` | `{ notebooks, sections, notes }`; notes come newest first, each with an `excerpt` |
| `POST /notes` | `{ parent?, title?, text? }` makes a note (in your first notebook if no parent) |
| `GET /notes/:id` | `{ note, text }` |
| `PUT /notes/:id` | `{ text, version }` gives `{ note, conflict }` |
| `PATCH /notes/:id` | `{ title?, parent? }`; parent is any notebook or section in the same space |
| `DELETE /notes/:id` | moves it to the trash. `POST /notes/:id/restore` brings it back |
| `POST /notes/sections` | `{ name, parent? }`. `PATCH` and `DELETE` work on `/notes/sections/:id` |
| `POST /notes/notebooks` | `{ name, space? }` makes a notebook (in your own space if none is given) |
| `PATCH`, `DELETE /notes/notebooks/:id` | `{ name }` renames it; `DELETE` trashes it (a notebook shared on its own is left instead) |
| `GET /notes/notebooks/:id/members`, `GET /notes/:id/members` | `{ shares, inherited, space: { name, members }, role, link }`: who it's shared with, who has it through its notebook, how many see it in its space (0 and no name when it was shared with you) |
| `PUT` the same | `{ username, role: "editor" \| "viewer" \| null }` shares, changes, or takes off. Anyone may leave |
| `POST`, `DELETE /notes/notebooks/:id/link`, `/notes/:id/link` | turns the public link on (gives `{ link }`) or off |
| `GET /notes/public/:token` | no sign-in: `{ note: { title, text, updatedAt } }` or `{ notebook: { name, sections, notes } }` |
| `GET /notes/people` | everyone it can be shared with |

Drive has the same for any folder or file: `GET`/`PUT /drive/nodes/:id/shares`
and `GET /drive/shared-with-you`. Shared items also come through `/drive/changes`
with `parentId: null` and `sharedWithYou: true`.

A notebook in the API is `{ id, name, space: { id, name, crest, color, members },
role, isSpace, sharedWithYou }`. A note's and a section's `notebookId` is the
notebook folder's id. A note shared with you on its own has `notebookId: null`.

**Kimono AI** knows your notebooks. Each message names them, and its system
prompt says how notes work (`lib/notes/agent.ts`). It asks for a notebook with
`kimono-access --space <space> --path <notebook>` like any folder, reads and
writes the `.md` files in it,
and keeps `kimono-remember` for what it should know about you. A note it
changes shows up in Notes the next time it's opened.

**MCP.** Outline served an MCP server at `https://notes.<domain>/mcp`. Kimono
Notes serves one at that same address, so a client already set up keeps
working once it signs in again.

## How it should feel

These are the same choices Kimono AI made (see `docs/kimono-ai.md`,
`code-app.tsx`, `CodeChat.kt`), applied to writing.

### Places

- **Web:** one surface beside the rail, with an 8px margin and 16px corners.
  Its parts are told apart by tone alone, with no hairlines.
  - The **note list** is 300px on `--k-container-low`. The **open note** is on
    `--k-container-lowest`, with text up to 720px wide.
  - The **notebooks panel** is 248px on `--k-container` and is closed by
    default, so there are never two sidebars. The list header holds a panel
    button and the place you're in (for example "Notes / Recipes ▾"); either
    one opens the panel over the list on `--k-spring`. Picking a place or a
    note closes it, and so do Esc and a click outside.
  - From the top, the panel holds:
    - **New note**, a 34px block on primaryContainer with a 2px inset base;
    - **Search** (32px), which lists matching notes in the panel;
    - **All notes**;
    - each notebook, with its sections folding under it;
    - **New notebook**;
    - **Shared with you**.
  - Panel rows are 32px with 8px corners. Each level is indented 14px, and the
    fold chevron sits on the left.
  - With no note open, the note area shows the blot and New note.
- **Web, under 1200px:** the list steps aside while a note is open, and a back
  arrow brings it back.
- **Web, under 760px:** list and note are separate screens, and the panel is a
  drawer.
- **Phone:**
  - The drawer is `ModalNavigationDrawer` on surfaceContainerLow, with 28dp end
    corners and a 340dp maximum width. It holds notebooks and sections as 48dp
    pill rows, and the selected one fills with secondaryContainer.
  - Notes are listed on the main screen. **New note** is a square Seal at the
    bottom right with a pencil, the same shape as Send/Stop.
  - The note opens full screen.

### Marks: the watercolour

Ink is for marks only. It never goes on controls, cards or text.

- A notebook's mark is its **crest washed in its colour** (`InkCrest`; kikyō in
  plum by default). Each notebook's mark is seeded by its id, so it looks the
  same on the web and the phone. The mark goes next to its name in the panel or
  drawer, and large (64) on the notebook's page header.
- A **shared notebook** also shows up to two members' portraits in
  `InkPortraitFrame`, overlapping, after its name.
- **Empty states** are a 96px `InkBlot`, seeded by the place and tinted quiet,
  holding the notes icon, with one line under it:
  - "Your notes will be here." for everything;
  - "Nothing here yet." for an empty section;
  - "No notes match." for search.
- **Checkboxes** in a note are `.k-ink-radio`-style ink rings. Ticking one
  draws an ink tick on a spring, and the line under it turns outline colour,
  with no strike line.
- **Focus** works like the composer's: while you write, a brush stroke in the
  app's colour spreads along the foot of the title (`code.css:1593-1611`).

### The note list

- The **header** is 44px: the panel button, the place in 18px Mincho (with its
  notebook above it when it's a section), who it's shared with, and a 32px
  **+** that makes a note right there.
- A **row** is 52px:
  - the **title** in bold 14px, then one line of excerpt at 12.5px in
    on-surface-variant;
  - on the right at 11.5px, one word, only when it says something: "now",
    "2h", "Tue", or an `InkLoader` while it saves;
  - in All notes, the notebook's small crest before the time.
- **Pluses:**
  - Each notebook and section row in the panel shows a 26px **+** and a
    **···** on hover or focus, and always on touch. The + makes a note there.
  - A notebook's ··· holds **New note**, **New section**, **Rename**,
    **Share** and **Delete**, or **Leave** for one shared with you.
  - A note's ··· holds **Share**, **Move** and **Delete**.
  - An empty list has its own **+ New note**.
- **Shared with you** lists notebooks, then single notes. Each shows a 20px
  portrait of whoever shared it, or their initial on primaryContainer.
- **Keys:**
  - `N` makes a note while you're not typing, and so does ⌘⌥N anywhere.
  - `/` or ⌘K goes to search. Outside the note, Notes' ⌘K wins over the rail's
    apps sheet. In the note, ⌘K makes a link and never reaches the rail.
- The open note's row gets the lightest container and a faint shadow, as the
  current chat does.
- New rows rise 12px into place. On the phone they use `animateItem` (a 380ms
  fade, then a spring with damping .8 and stiffness 380). Reduced motion is
  honoured.

### Writing

- The **title** is a 28px Mincho field above the body. It is saved when it
  loses focus, and a blank one becomes "Untitled".
- **A new note is only saved once it has a title or words.** One of yours
  left blank and Untitled is quietly put in the trash when you leave it.
- The **body is still Markdown**, read as a document. Markup shows only while
  you're in it:
  - bold, italic, code and link markers come back when the caret touches that
    span;
  - heading, quote and rule markers come back when the caret is on that line;
  - code fences show while the caret is in the block.
- **How it looks:**
  - bullets are dots, filled, then open rings a level down;
  - `- [ ]` is an ink ring that ticks when clicked, and the caret steps over
    it in one. The `[ ]` it toggles is found from the line's text;
  - numbers stay, in on-surface-variant;
  - links open on ⌘/Ctrl-click, or a long press on the phone;
  - pictures stay as their words, as Drive's Markdown preview does. Raw HTML
    never runs.
- **Shortcuts (⌘ or Ctrl):**
  - B, I and E (inline code); ⌘B at the end of bold steps out of it;
  - K makes a link, then Tab or Enter jumps to the address, and again out;
  - ⇧7 numbered list, ⇧8 bullets, ⇧9 checklist;
  - ⌥1, ⌥2 and ⌥3 for headings.
- **Typing:**
  - `# `, `- `, `1. `, `[] ` and `> ` at the start of a line make a heading,
    bullet, numbered item, checkbox and quote;
  - Enter continues a list or quote, and on an empty item or quote line it
    ends it;
  - Tab and ⇧Tab indent and outdent list items. In code Tab is two spaces,
    and elsewhere it does nothing;
  - Backspace right after a list marker removes the marker.
- The **format bar** sticks at the foot of the note: Bold, Italic | Heading
  (H1, H2, H3, then off) | Bullets, Checklist | Link, Code.
  - Its buttons are 32×30 flat blocks with 6px corners, with tooltips like
    "Bold ⌘B".
  - The formatting at the caret is filled with primaryContainer and a 2px
    inset base.
- Web: CodeMirror 6 with Markdown decorations. Phone: `BasicTextField` with
  an output transformation that styles the spans.
- **Saving is automatic.** Notes saves 800ms after typing stops, when the
  field loses focus, and when you leave. There is no Save button.
  - The status follows the one-word rule. While a save is in flight a 14px
    `InkLoader` sits where the time is. Once saved it shows the time and
    nothing else.
  - If a save fails: **"Not saved"** and a Retry seal. Keep the text, and keep
    trying in the background.
  - On the phone with no connection: **"Waiting for a connection"**. The edit
    is kept on the device and sent when the connection is back, under the same
    version rule.
  - If someone else saved first, a snackbar says "Someone else changed this.
    Yours is kept as a copy." with **Open copy**.
  - An open note follows edits made elsewhere: on coming back to the window
    and every 15s, a newer version comes in without moving the caret, unless
    you have edits waiting.
- The **phone works offline for reading**: the library and opened notes are
  cached and refreshed from Drive's change feed.

### Buttons that are working

A Seal shows it is busy with `busy`. The word is hidden but keeps its width,
and a plain `InkLoader` takes its place. The seal keeps its colour, because
it is working, not switched off. Labels never change to "Saving…". On the
phone, the `InkLoader` sits beside the label, as `Seal.kt` does.

- **New note is optimistic.** The editor opens at once, empty, with focus in
  the title, and the POST runs behind it. What you type waits for the id, then
  saves. The seal shows busy only if the POST takes longer than 300ms.
- **Delete** a note: it goes straight to the trash with an **Undo** snackbar
  for 6s. It is recoverable, so there is no confirm.
- **Delete** a section that holds notes: an inline confirm, as for a chat:
  "Delete Recipes and its 4 notes?" with **Delete** and **Keep**.
- **Leave** something shared with you: hold to confirm (`HoldSeal`). Only
  someone who can edit it can bring you back, so it gets the stronger gesture.
- **Share** (a notebook or a note) opens one sheet, like a document's:
  - At the top: "Everyone in Family can see this." (when its space has others),
    or for a note in a shared notebook, "Mina and Ren have it through Recipes."
  - "Add people": the household picker. Each person's row has their portrait,
    name, and a joint switch for EDIT / VIEW, plus Take off (×).
  - Changes apply as you make them, each row showing a `InkLoader` while it
    saves. There is no Share button to press; the sheet's button is **Done**.
  - A viewer sees who has it, but no switches.
  - **Public link**, at the foot: a joint switch. When on, the link shows with
    **Copy**, and "Anyone with the link can read this." Turning it off ends the
    link at once. It's hidden when the admin has public links off.
- **The public page** (`/n/<token>`) is read-only:
  - a note is its title in Mincho and its text typeset like Drive's Markdown
    preview (no raw HTML, pictures as their words);
  - a notebook adds a side list of its sections and notes;
  - the Notes bloom sits at the foot, and nothing else of Kimono shows.
- **New notebook:** a name, and a choice of space (your own first). The
  button is **Make**.

### Words

Short, in the second person, and nothing about internals. Never use the words
Drive space, file, Markdown, `.md`, version, Outline or MCP in the app. The
words to use are note, notebook, section, share, move, delete.

| Where | Text |
|---|---|
| Errors | "That didn't work." |
| Notes switched off | "Notes isn't switched on." (admins go to its page) |
| Leaving | "Leave Kyoto trip?" with "You'll need to be asked back." |

### Colour and night

Notes uses the app colours from its definition (`#b56d78`, `#5f3441`,
`#ecd2b7`) through `accentOf`. There is no second palette, and state never
gets a colour of its own. At night: web `tokens.css:196-241`, phone
`kimonoNight`.

## MCP

`https://notes.<domain>/mcp` is Streamable HTTP, stateless: each POST is
JSON-RPC answered in JSON, with no session and no stream (GET and DELETE
answer 405). Its tools are `list_notebooks`, `search_notes` (every word, in
titles and text), `read_note`, `create_note`, `update_note` (with the
version read; a conflict keeps both, as the app does), `move_note` and
`delete_note` (to the trash). They act as the person who signed in, through
Drive's rules (`lib/notes/mcp-protocol.ts`, `mcp-server.ts`).

Sign-in is OAuth 2.1 as MCP clients expect (`lib/notes/mcp-oauth.ts`):

- `/.well-known/oauth-protected-resource/mcp` and
  `/.well-known/oauth-authorization-server` say where to sign in; the
  issuer is the Notes address.
- Clients register themselves at `/mcp/register` and are always public:
  PKCE (S256) is what proves the redeemer is the one that asked.
- The person allows the app at `/mcp/authorize` on the Portal, where they
  are signed in. The page names the app and where it returns to.
- `/mcp/token` gives an hour-long access token and a refresh token that is
  used once and lapses after 30 days unused. A code or refresh token
  presented twice ends the grant. Tokens are opaque, stored hashed in
  `notes-mcp.db`, and only good for the address they were issued for.
- Access ends with `/mcp/revoke`, signing out everywhere, or the account
  being switched off.

The appliance's proxy publishes the Notes address directly, as it does the
Portal's: MCP and its sign-in go to the Portal, anything else to `/notes`
there (`lib/notes/mcp-site.ts`, rendered by `deployment.ts`). Tests:
`pnpm --filter @kimono/portal test:notes-mcp`.

## Not in the first version

- Pictures and attachments inside notes.
- Note history.
- Editing together live; the version rule keeps both edits instead.
- Public links to a note.

## Bringing notes over from Outline

Outline's database outlives the app (compose keeps a removed service's
volumes). `sudo kimono server import-outline` starts Postgres on that volume
with no network, writes what it reads to `/var/lib/kimono-portal/imports/outline.json`
and restarts the Portal, which brings it into Notes at boot and prints how it
went (`lib/notes/outline-import.ts`):

- each collection is a notebook in its creator's own space, shared only
  with the people and groups added to it in Outline (editors, or viewers for
  read-only). Outline opens collections to the whole workspace by default,
  which isn't counted: a rerun takes back shares an earlier run made that way,
  and keeps any added by hand since;
- a document with documents under it is a note plus a section of the same
  name beside it, holding them; archived ones go in an "Archived" section;
- drafts go to their writer's own "Drafts" notebook; deleted documents and
  templates stay behind;
- people are matched to accounts by email, then by name; anyone unmatched is
  listed, and running it again once they have an account adds only what is
  missing;
- attachments don't come across; links to them are counted.

Tests: `pnpm --filter @kimono/portal test:outline-import`.
