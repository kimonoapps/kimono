# ADR 0004: Surface hierarchy and semantic colour

- Status: Superseded — rejected on review, 2026-10-04. The established Kata
  contract in `docs/design-system.md` stands; only the narrowed Tools
  refinement and the app-colour rule below were kept.
- Date: 2026-10-04 (proposed and rejected the same day)

## Context

The Tools proof page — the API reference — came out as a dense fence of
rectangles: a frame around the workspace, rules around every seal and input,
hairlines on every row, and little else to tell one region from another. A
review of the shared tokens and components was asked for, and the review's
answer was a new system rather than a tighter use of the existing one.

## Decision as proposed

Replace paper, ink and wood with **surface tiers** (canvas, recessed, well,
sheet, raised, sumi); add a **semantic colour family** — indigo (藍) for
selection, focus and read-only methods, gold (山吹) for caution and credentials,
vermilion (朱) for failure and destructive actions, moss and suō washes; replace
edge weight with **toned one-pixel edges** (faint, edge, strong); replace the
one hard tray shadow with a ladder of offset depths; fill primary seals with the
identity colour; wash stated seals with a role colour; and derive a per-app
**brand wash** for section headings so each application's tint follows its own
palette. The shared Tray, Compartment, Seal, Field, Door and Rows styles were
rewritten to these tokens and the Tools page was dressed in them.

## Outcome

Rejected. It did not read as Kimono. Specifically:

- **A second palette.** Indigo selection, gold caution and vermilion danger are
  the vocabulary of a generic admin console. Kata has one signal colour and one
  meaning for moss; state is carried by a word and a change of form, not by a
  tint per state.
- **Materials replaced by tiers.** Canvas / well / raised are abstractions of
  elevation. Kimono's surfaces are paper, and paper stacks by edge, not by
  shade. The warm ground and sheet were also darkened, so every page shifted.
- **Edge weight abandoned.** "Can I touch this" is the rule that assigns a
  rule or a hairline. Toned one-pixel edges on everything erased the
  distinction between a seal and a divider.
- **App colour spread across the room.** Filled seals, washed headings and a
  brand wash let an app recolour its page. An app's colour belongs on its
  bloom, its name, its primary action and one small selected marker — nothing
  else — or Kimono stops hosting apps and starts becoming them.
- **The shared package rewritten for one page.** The excess was in Tools; the
  fix landed in every component the portal uses.

## What was kept

- **The diagnosis.** Tools *was* over-outlined. The fix is composition, not
  colour: the workspace is one tray with two compartments meeting on one rule;
  operations are rows with hairlines inset so none touches the frame; method,
  access, version and status are stated seals in hair and faint ink; inputs
  are drawn in hair until a request can be tried, then in ink; the key drawer
  is wood. All of it from existing tokens, in `apps/portal/src/app/tools/tools.css`
  alone. The shared stylesheets are back on the established contract.
- **The compact, Swagger-like endpoint layout** and the Tools API behaviour.
- **A written rule for an app's colour**, now in `docs/design-system.md`
  under "An app's colour", and enforced by narrowing the app shell's palette
  to `--k-app-accent`, `--k-accent` and `--k-accent-pale`. The shell no longer
  overrides Kimono's own `--sakura` / `--vermillion` chrome colours inside an
  app.
- **Earlier, unrelated work** that happened to share the same revision — the
  Seal's `ref` support, the app-lockup sizing and bloom glyph work, the app
  registry and Tools API — is untouched.

## Consequences

The portal's shared components look as they did before this round. The Tools
page is the proof that density can be handled inside Kata: when a page feels
fenced, the answer is fewer frames and better seams, not more colours. Any
future proposal for role-coloured chips or surface tiers should start from this
record of why they lost.
