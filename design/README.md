# Design

Kimono's visual language is cut here before it reaches the app.

The workflow is **Katagami** (型紙 — the stencil a dyer cuts once, then presses
onto every bolt so the whole garment carries one pattern). Run it with
`/katagami`; the process itself lives in `.claude/skills/katagami/SKILL.md`.

## Shipped

型 Kata is now a real package: `packages/ui/src/kata.css` holds the tokens and
the three primitives, `packages/ui/src/index.tsx` exports `Door`, `Joint`,
`Seal`, `StatedSeal`, `Tray`, `Compartment` and `BloomMark`, and the contract is
written up in `docs/design-system.md`. The portal imports `@kimono/ui/kata.css`
before its own stylesheet.

## Where we are

**Buttons:** 03 Shoji, 04 Tsugite and 12 Hold are kept. Joint profile for 04
still open; specimens 01, 02, 05–11, 13, 14 still unruled.
See `specimens/01-buttons.html`.

**Palette:** five directions out for verdict in `specimens/02-palette.html`,
each shown on the three kept specimens rather than as bare swatches.

**Transitions:** six in `specimens/03-transitions.html`, each triggered by Open
so the press *is* the page change. Pulled forward from element class 7 because
the kept buttons are slow enough to carry the transition themselves.

## How it runs

    0  Motif brief      name the devices and the job each one holds   → motifs.md
    1  Specimen sheet   one element class, real interactive variants  → specimens/
    2  Verdict          keep / adjust / kill, per specimen            → motifs.md
    3  Cut the stencil  accepted specimen becomes tokens and CSS      → decisions/
    4  Proof page       one real page, accepted vocabulary only
    5  Roll out         remaining pages, one at a time

Nothing is finished until it survives a proof page. Anything a page needs that
has not been cut goes back to Stage 1 rather than being improvised inline.

## Files

- `motifs.md` — the device vocabulary, the job each holds, and what has been ruled out
- `queue.md` — element classes in order, with status
- `specimens/` — one HTML sheet per round, viewable in a browser
- `decisions/` — one ADR per accepted element class, numbered as in `docs/decisions/`

## The rule everything is tested against

A device must do structural work, not just decorate. Vines that wrap the page
*and* underline its links are a language; vines that only sit in the corners are
wallpaper.

## Surface and hierarchy revision — 2026-10-04 (rejected)

A review of the Tools proof page proposed replacing Kata's materials with
surface tiers, adding a semantic chip palette (indigo selection, gold caution,
vermilion danger), thinning every edge to a toned pixel, and letting each app's
colour wash its headings. It was rejected: it did not read as Kimono. The
shared package stays on paper, ink and wood with depth as edge weight. What
survived is narrower — Tools keeps its compact endpoint layout and is composed
from the existing vocabulary with its hairlines inset, and the four places an
app's colour may appear are now written into `docs/design-system.md`. The
record, including why each part lost, is `decisions/0004-surface-hierarchy.md`.
