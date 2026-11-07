# Kimono Notes (design, replacing Outline)

Status: the server is built (2026-11-07); web, phone and `/mcp` are next.

Notes is where a household writes things down: groceries, the Wi-Fi password
for guests, a trip plan, a recipe. It is Kimono's own app now. Outline is gone.

## What it is underneath

Notes has no store of its own. **A notebook is a Drive space whose purpose is
`notes`.** Folders in it are **sections** and every `.md` file is a **note**.
The note's title is its file name without `.md`. So the same notes show in Drive,
in the Files app on iPhone and Android, and in anything that reads Markdown.
Drive's rules decide who may read or change them.

- Everyone gets their own notebook, **Notes**, made the first time they open
  the app. Nobody has to set anything up.
- **Sharing a section turns it into a notebook of its own.** Drive does this
  with `folderToSpace`, and the new space keeps the `notes` purpose. The owner
  picks people as editors or viewers. A shared notebook lists under your own.
- Saving goes through Drive's upload bookkeeping, so the change log, the Files
  app and conflict handling all work as they do for any file. A save names the
  `version` it was edited from. If someone else saved first, theirs stays and
  yours is kept beside it as `… (edited elsewhere).md`.
- Deleting puts the note in Drive's trash for 30 days.

API: `/api/v1/notes` (code: `apps/portal/src/lib/notes`, `src/app/api/v1/notes`).

| | |
|---|---|
| `GET /notes` | `{ notebooks, sections, notes }`; notes come newest first, each with an `excerpt` |
| `POST /notes` | `{ parent?, title?, text? }` makes a note (your own notebook if no parent) |
| `GET /notes/:id` | `{ note, text }` |
| `PUT /notes/:id` | `{ text, version }` gives `{ note, conflict }` |
| `PATCH /notes/:id` | `{ title?, parent? }` |
| `DELETE /notes/:id` | moves it to the trash. `POST /notes/:id/restore` brings it back |
| `POST /notes/sections` | `{ name, parent? }`. `PATCH` and `DELETE` work on `/notes/sections/:id` |
| `POST /notes/sections/:id/share` | `{ members: [{ username, role }] }` makes a new notebook |
| `GET`, `PUT /notes/notebooks/:id/members` | `{ username, role \| null }`. Anyone may leave |

**Kimono AI** knows your notebooks. Each message names them, and its system
prompt says how notes work (`lib/notes/agent.ts`). It asks for a notebook with
`kimono-access` like any other space, reads and writes the `.md` files in it,
and keeps `kimono-remember` for what it should know about you. A note it
changes shows up in Notes the next time it's opened.

**MCP.** Outline served an MCP server at `https://notes.<domain>/mcp`. Kimono
Notes serves one at that same address, so a client already set up keeps
working once it signs in again.

## How it should feel

These are the same choices Kimono AI made (see `docs/kimono-ai.md`,
`code-app.tsx`, `CodeChat.kt`), applied to writing.

### Places

- **Web, wide:** a side panel and a page.
  - The panel is 300px on `--k-container` with 28px corners, and folds away on
    `--k-spring`, like Kimono AI's chat list. From the top:
    - **New note**, a primaryContainer pill, as New chat is;
    - **Search notes**;
    - an ink rule (`.k-ink-rule`);
    - **All notes**;
    - each notebook, with its sections folding under it.
  - The page holds the note list or the open note. At 1280px and wider, the
    list stays as a 340px middle column while a note is open.
- **Web, under 980px:** list and note are separate screens, as in Kimono AI.
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

- A row is a soft 56–72px row:
  - the **title** in bold 15px, then one line of excerpt in on-surface-variant;
  - on the right, one word, only when it says something: "now", "2h", "Tue",
    or a `MorphLoader` while it saves;
  - in All notes, the notebook's small crest before the time.
- A ··· menu shows on hover, and always on touch. It holds **Move**, **Share
  section** (owners), and **Delete**.
- The open note's row gets the lightest container and a faint shadow, as the
  current chat does.
- New rows rise 12px into place. On the phone they use `animateItem` (a 380ms
  fade, then a spring with damping .8 and stiffness 380). Reduced motion is
  honoured.

### Writing

- The **title** is a Mincho headline field above the body. The file is renamed
  when it loses focus. A blank title becomes "Untitled".
- The **body stays Markdown, styled where you type** (live preview, not a
  split view):
  - headings, bold, italics, lists, quotes, code and links take their look in
    place, and the markup characters fade to outline colour;
  - checkboxes can be clicked or tapped;
  - links open on ⌘/Ctrl-click, or a long press on the phone;
  - pictures stay as their words, as Drive's Markdown preview does. Raw HTML
    never runs.
  - Web: CodeMirror 6 with Markdown decorations, or the equivalent.
  - Phone: `BasicTextField` with an output transformation that styles the spans.
    Above the keyboard, a row offers checklist, heading, bold, list and done.
- **Saving is automatic.** Notes saves 800ms after typing stops, when the
  field loses focus, and when you leave. There is no Save button.
  - The status follows the one-word rule. While a save is in flight a 14px
    `MorphLoader` sits where the time is. Once saved it shows the time and
    nothing else.
  - If a save fails: **"Not saved"** and a Retry seal. Keep the text, and keep
    trying in the background.
  - On the phone with no connection: **"Waiting for a connection"**. The edit
    is kept on the device and sent when the connection is back, under the same
    version rule.
  - If someone else saved first, a snackbar says "Someone else changed this.
    Yours is kept as a copy." with **Open copy**.
- The **phone works offline for reading**: the library and opened notes are
  cached and refreshed from Drive's change feed.

### Buttons that are working

A Seal shows it is busy with `busy`. The word is hidden but keeps its width,
and a plain `MorphLoader` takes its place. The seal keeps its colour, because
it is working, not switched off. Labels never change to "Saving…". On the
phone, the `InkLoader` sits beside the label, as `Seal.kt` does.

- **New note is optimistic.** The editor opens at once, empty, with focus in
  the title, and the POST runs behind it. What you type waits for the id, then
  saves. The seal shows busy only if the POST takes longer than 300ms.
- **Delete** a note: it goes straight to the trash with an **Undo** snackbar
  for 6s. It is recoverable, so there is no confirm.
- **Delete** a section that holds notes: an inline confirm, as for a chat:
  "Delete Recipes and its 4 notes?" with **Delete** and **Keep**.
- **Leave** a shared notebook: hold to confirm (`HoldSeal`). Only an owner can
  bring you back, so it gets the stronger gesture.
- **Share a section:** a sheet with the people picker Drive uses. Each person
  is an editor or a viewer, set with a joint switch. The button is **Share**.
  Afterwards the section moves under its own notebook, with a short spring.

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

## Not in the first version

- Pictures and attachments inside notes.
- Note history.
- Editing together live; the version rule keeps both edits instead.
- Public links to a note.
- Importing from Outline.
