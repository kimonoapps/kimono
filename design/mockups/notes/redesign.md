# Notes redesign (agreed 2026-11-07)

The mockup is `redesign.html` (serve it from the repo root, since it reads the
real tokens). The owner's one change to it: **the notebooks panel collapses on
its own.** Don't show two full sidebars.

## What's wrong now

- **Three floating cards:** big gaps between them, and phone-sized controls on a
  desktop. The note gets about 600px of a 1440px screen.
- **Raw markup:** it shows, only faded (`*hey*`, `# hi`, `**hi**`). There are no
  shortcuts and no toolbar.
- **Hard to find actions:** the notebook menu has no New section, actions only
  show on hover, and the only plus is "New notebook".
- **Sharer's initial:** it's invisible at night (`--k-on-wash` on `--k-fold`).
- **"Untitled" notes:** they stay, because New note saves the note straight away.

## Layout (web)

- **One surface:** 8px margin, 16px corners, areas told apart by tone with no
  hairlines.
  - The list is 300px on `--k-container-low`.
  - The note is on `--k-container-lowest`, with text up to 720px wide and 20px
    padding.
- **The notebooks panel is 248px on `--k-container` and is closed by default.**
  - The list header holds a panel button and the current place, for example
    "Notes / Recipes ▾". Clicking either opens the panel over the list, sliding
    in on `--k-spring`.
  - Picking a notebook, a section, All notes or Shared with you closes it again,
    and so do Esc and a click outside.
  - It never stays open beside the list.
- **Below 1200px**, the list hides while a note is open, with a back arrow.
- **Below 760px**, list and note are separate screens and the panel is a drawer.

## Sizes

- **Panel:**
  - The heading is 18px Mincho.
  - New note is 34px tall, on `--k-primary-container` with a 2px inset base,
    so it reads as a seal block, not a pill.
  - Search is 32px.
  - Rows are 32px with 8px corners, indented 14px per level, with the fold
    chevron on the left.
- **List:**
  - The header is 44px, with an 18px Mincho heading.
  - Rows are 52px: a 14px bold title, one line of 12.5px excerpt, and the time
    at 11.5px on the right.
- **Note:** the title is 28px Mincho.

## Pluses

- **Notebook and section rows:** each shows a 26px "+" and a "···" on hover or
  focus (always on touch). The "+" makes a new note there.
- **Notebook menu:** New note, New section, Rename, Share, Delete (or Leave).
- **List header:** a 32px "+" that makes a note in the current place.
- **Empty list:** an inline "+ New note".
- **Keys:**
  - `N` makes a new note while you're not typing, and so does ⌘⌥N (Chrome
    keeps ⌘N for itself).
  - `/` or ⌘K goes to search. When you're outside the editor, this must win
    over the rail's ⌘K apps sheet (`rail.tsx:76`). Inside the editor, ⌘K is a
    link and must not reach the rail.

## Editor

The text is still Markdown underneath (CodeMirror 6 on the web).

**Markup only shows while you're in it:**
- Bold, italic, code and link markers come back when the caret touches that
  span.
- Heading, quote and rule markers come back when the caret is on that line.
- Code fence markers stay hidden until the caret is in the block.

**How things look:**
- Bullets are dots: filled at even depths, open rings at odd depths.
- `- [ ]` is an ink ring that ticks when clicked, and the caret skips the "- ".
  To find the `[ ]` it toggles, read the line text, not a stored position.
- Numbers stay visible, in on-surface-variant.

**Shortcuts (⌘ or Ctrl):**
- B, I and E (inline code).
- K makes a link; Tab or Enter then jumps to the address.
- ⇧7 numbered list, ⇧8 bullets, ⇧9 checklist.
- ⌥1, ⌥2, ⌥3 headings.
- ⌘B at the end of bold text steps out of it.

**Typing:**
- Tab and ⇧Tab indent and outdent list items. Elsewhere Tab does nothing,
  except two spaces in code.
- Enter continues a list; an empty item or empty quote line ends it.
- `# `, `- `, `1. `, `[] ` and `> ` at the start of a line become a heading,
  bullet, numbered item, checkbox and quote.
- Backspace right after a list marker removes the marker.

**Format bar:**
- It sticks at the foot of the note: Bold, Italic | Heading (H1, H2, H3, then
  off) | Bullets, Checklist | Link, Code.
- Buttons are 32×30 with 6px corners and flat, with tooltips like "Bold ⌘B".
- The button for the formatting at the caret is filled with
  `--k-primary-container` and a 2px inset base. No pills, no gradients.

## Empty states

- An empty list shows a 64px quiet `InkBlot` with one line and an inline New
  note.
- With no note open on a wide screen, the note area shows the blot and New note.

## Fixes

- **Sharer:** show a 20px `Portrait`, with the initial on
  `--k-primary-container` in its text colour.
- **New notes:** a new note is only saved once it has a title or text. A note
  left blank and Untitled is quietly trashed when you leave it.
- **Rail rooms:** call Notes' rooms "All" and "New".

## Phone (Compose)

The phone gets the same changes, in Compose:
- the drawer stays as it is (it already collapses);
- the same density and pluses: the "+" and ··· on drawer rows (long-press on
  touch), and the + in the list header;
- the same live-preview behaviour;
- the format bar sits just above the keyboard and replaces the current
  keyboard row;
- hardware-keyboard shortcuts as listed above, where iPad and Android allow;
- the same fixes.
