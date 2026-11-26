# 型 Kata — the Kimono design system

Kata is **Material 3 foundations with Kimono's personality** (ADR
`design/decisions/0006-m3-foundations.md`). The colour roles, type scale,
corner scale and spring are the phone app's (`apps/compose`, `Kata.kt`), so
the website and the app are one product. The hues, the hanko seal, the joint,
the door, blooms, petals and the ink-and-wash hand are Kimono's own.

This document is the contract. `packages/ui/src/kata.css` enforces it, and
`packages/ui/src/styles/tokens.css` is the only file that names a hex. The
phone reads the same file through `apps/compose/scripts/tokens.mjs`, which
writes `KataTokens.kt`. Run it after every token change.

## Colour

### Pigments

| Pigment | Token | Value | For |
| --- | --- | --- | --- |
| 蘇芳 suō | `--k-suo` | `#a84d63` | primary: the action colour, focus, error text |
| suō, deep | `--k-suo-deep` | `#7e3448` | coloured text, hover |
| plum | `--k-plum` | `#4e2b37` | secondary: Mincho headings and the wordmark |
| moss | `--k-moss` | `#5c7150` | tertiary: running, and nothing else |
| ink | `--k-ink` | `#24221f` | the ink pigment for drawn marks |
| wood | `--k-wood` | `#dcc090` | the joint only |
| 漆 urushi | `--k-urushi` | `#2a1d22` | a reply from a server, the key reveal |

There is **no second palette.** Selection, information, caution and failure
are not hues. They are a container tone, a word, or a form that changes.
Decision 0004 rejected a semantic chip family (indigo, gold, vermilion), and
ADR 0006 kept that ruling.

### Roles

Pages read roles, never pigments. These are Material 3's tonal roles seeded
from suō. The same names flip by night (`data-theme="dark"`, or the system
when no one picked) and step apart under `prefers-contrast: more`.

| Role | Token | Day | For |
| --- | --- | --- | --- |
| surface | `--k-surface` | `#fffbf7` | the page |
| container, lowest | `--k-container-lowest` | `#ffffff` | a field, a plate on a door |
| container, low | `--k-container-low` | `#fcf4ef` | trays, cards, rows' ground |
| container | `--k-container` | `#f7eee8` | a navigation rail, a pane |
| container, high | `--k-container-high` | `#f1e8e2` | dialogs, menus, a door |
| container, highest | `--k-container-highest` | `#ebe2dc` | quiet seals, chips, code |
| on surface | `--k-on-surface` | `#221a17` | text |
| on surface, variant | `--k-on-surface-variant` | `#54443f` | secondary text, labels |
| outline, variant | `--k-outline-variant` | `#d9c2bc` | a divider between rows |
| primary container | `--k-primary-container` | `#ffd9df` | the selected thing, the room you are in |
| secondary container | `--k-secondary-container` | `#f6e0e2` | a plum-tinted pick |
| tertiary container | `--k-tertiary-container` | `#dce8cf` | running |

Each container has an `--k-on-…` partner for its text. Text on a suō fill is
`--k-on-accent`.

The old paper names (`--k-ground`, `--k-sheet`, `--k-fold`, `--k-lift`,
`--k-hair`) still resolve, and now point at the roles above so older pages
follow. New code uses the roles.

### An app's colour

Inside an app, the shell sets `--k-accent`, `--k-accent-deep` and
`--k-accent-pale` to that app's colour. The colour may appear in five places:

- the **bloom**, which is the app's mark, and the petals of the crossing that
  opens it;
- the app's **name** in the lockup;
- the **primary action**: a seal, the tab of a compartment that wants you, a
  focus ring;
- one **selected marker** beside the chosen thing;
- the **cord** under the header.

The sakura crossing blends from the current accent to the destination's.
Entering an app blends house pink into its colour, and returning blends back.
Everything else keeps the house roles. An app is recognised by its mark and
by what it asks of you, never by a tinted room.

## Depth is tone

Hierarchy is a step in container tone. **Nothing is enclosed in a line.**
A tray is `--k-container-low` on the surface with no border and no shadow.
Inside a tray, compartments and rows meet on one 1px divider. A divider
separates siblings and never draws a box.

Only a surface that floats above the page casts a shadow:
`--k-shadow-raised`, which is plum-tinted and used for menus, dialogs and
popovers. Paper grain, hairline enclosures and the 3px frame are retired.

### 組 Kumi — composition

- **A tray is one container.** Compartments inside it share it; they are not
  containers of their own.
- **Containers don't nest in the same tone.** If one sits inside another, it
  steps up a tone, or it is a row.
- **A grid of free-standing items is containers, not outlines.** Use tonal
  cards with gaps between them, never boxes drawn in hair.

## Shape

Material's corner scale, with nothing between the steps.

| Token | Size | For |
| --- | --- | --- |
| `--k-r-xs` | 4px | inline code |
| `--k-r-s` | 8px | chips, the door's plate, small fields |
| `--k-r-m` | 12px | fields, code panes, menus, the seal |
| `--k-r-l` | 16px | the door, cards |
| `--k-r-xl` | 28px | trays, dialogs, sheets |
| `--k-r-full` | 999px | portraits, blossom hearts, real circles |

Shapes morph on interaction. A door tightens from `l` to `m` on reach, and a
busy seal morphs a shape on its face. **Buttons never become pills.** The seal
is a carved block (see below). Round containers are M3's; round buttons are
not Kimono's.

A portrait is the person's picture. Someone without one gets the first letter
of their name in plum Mincho, drawn by Kimono (`Portrait` in the Portal).

## Type

Shippori Mincho names things; Zen Maru Gothic does the work (ADR 0005). The
scale is the phone's.

| Role | Face | Size / line |
| --- | --- | --- |
| display | Mincho 600 | 52 / 56 · 42 / 46 · 34 / 38 |
| headline | Mincho 600 | 30 / 34 · 26 / 31 · 22 / 27 |
| title, large | Mincho 600 | 21 / 26 |
| title | Gothic 700 | 16 / 22 · 14 / 20 |
| body | Gothic | **16 / 24** · 14 / 20 · 12.5 / 18 |
| label | Gothic 700 | 13 / 16 · 12 / 16 · 11 / 14 |
| mono | `--k-mono` | 13, never smaller |

- **Mincho names**: pages, apps, and the one sentence that matters. It is
  never body copy and never a row title.
- **Body is 16px.** 14px is for secondary copy, and nothing is set at 12px.
- **Mono is only ever an address, a number or code.**
- Only Mincho 600 is loaded, and `font-synthesis: none` stops faux bold.

`.k-title`, `.k-heading`, `.k-label` and `.k-caption` carry the common roles.

## Space and size

Spacing is `--k-space-1` to `--k-space-8`: **4 · 8 · 12 · 16 · 24 · 32 · 48 ·
64**. Nothing between.

Controls are `--k-control` (48px, Material's touch target) and
`--k-control-compact` (40px, padded out to a 48px hit area). The shell has one
measure for the header and every page: `--k-shell-width`, inset by
`--k-shell-gutter`.

## Motion

| Duration | Token | For |
| --- | --- | --- |
| 120ms | `--k-t-tap` | a press going down |
| 180ms | `--k-t-state` | hover, focus, colour |
| 240ms | `--k-t-fold` | a disclosure, a door's leaves, a shape morph |
| 400ms | `--k-t-seat` | a joint seating |
| 900ms | `--k-t-cross` | a crossing between apps |

Spatial movement uses `--k-spring`, Material's expressive spring. Colour and
opacity use `--k-ease-settle`. Departures use `--k-ease-leave` and never take
more than 180ms. Wood seats on `--k-ease-seat`.

### 動 Dō — what may move, and why

**1. Motion must be caused.** Something moves only because of your pointer or
keyboard on a control, a crossing, or the system changing state, such as an
app starting or a backup finishing. Nothing loops without a cause.

**2. One event, one motion.** If a crossing delivered a page, the page does
not animate in as well. The crossing is the arrival.

**3. Motion is in the material's own plane.** A screen slides sideways, a
joint seats along its axis, and a shape morphs in place.

Someone who asked for less motion gets the state without the movement. One
block in `tokens.css` handles that for every primitive.

### Crossings

Moving between apps is a left-to-right swipe with petals travelling alongside.
Petals mean you are crossing between apps, and they appear nowhere else.

**A crossing covers completely before it swaps.** A swap that is half covered
is visible, and hiding it is the reason a transition exists.

**The press starts the load, and the cover decides when it is seen.** Reaching
for a door warms its destination, and pressing it begins the fetch. The page
changes hands at full cover. If the page is not ready, the crossing holds,
covered and still. It plays out once the page is standing, with Material's
loading indicator if the wait runs long.

> Three CSS traps this system has already hit:
>
> - A timing function on the `animation` shorthand is re-applied between every
>   pair of keyframes, so multi-stop animations need a per-keyframe
>   `animation-timing-function`.
> - A keyframe that sets only `opacity` still splits the `transform` timeline,
>   so animate the two separately.
> - The `animation` shorthand resets `animation-play-state`, so the rule that
>   holds a crossing at full cover needs `!important`.

### Waiting

- **`MorphLoader`** is for a wait with no measure. It is Material 3
  Expressive's loading indicator, painted: one shape morphs through Material's
  shapes as it turns, washed in suō with a broken brush edge.
- **`BusyFace`** is for a seal that is waiting. It keeps its size and its
  word, and a shape morphs on its face.
- **`InkWave`** and **`InkRing`** are for a wait you can measure, such as an
  upload. They are wavy progress, brushed.

## The primitives

Every interactive thing is one of these, or a Material component dressed in
the roles above (fields, menus, chips, dialogs). **If a need doesn't fit, it is
text and a seal, not a new object.**

### 判 Seal — commits an action, or states a fact

```tsx
import { Seal, StatedSeal } from "@kimono/ui";

<Seal type="submit">Save app setup</Seal>
<StatedSeal state="running">Running</StatedSeal>
```

The button is a hanko, not a pill. Material supplies its colours, its 48px
height and its 15px bold label. Kata supplies the object: a carved block with
12px corners, a 3px base it stands on, and the carved inner ring a real hanko
carries. Pressing it sinks the block onto its base and tightens the ring.
Releasing leaves an impression that spreads and fades. Surfaces are flat, with
no gradients.

- **Primary** is suō with near-white lettering.
- **Quiet** is the same block uninked, on the highest container with no ring.
- **Danger** states the consequence on a rose wash, and inks only on reach.
- **Disabled** lifts the seal off its base with a reason beside it. Opacity is
  never the only signal.
- **Hold to confirm** is for things that can't be undone. Petals pile up over
  1.4s while you hold, and scatter if you let go early.

Seals in a row sit in one group (`k-seal-group`, `k-form-actions`, the page
header's actions), 12px apart, with the primary first. Stamped, a seal states
a fact: `running` · `private` · `wants` · `quiet`.

### 継手 Joint — turns something on or off

```tsx
import { Joint } from "@kimono/ui";

<Joint checked={on} onChange={setOn} label="Run this application" profile="aikaki" />
```

The only switch. Apart is off, seated is on, and it carries `role="switch"`.
The profile is a promise about the setting:

| Profile | Joint | Says |
| --- | --- | --- |
| `ari` | dovetail | meant to stay on |
| `hozo` | tenon | a plain, neutral connection |
| `aikaki` | half-lap | something you expect to flip |

### 障子 Door — goes somewhere

```tsx
import { Door } from "@kimono/ui";

<Door href="/admin/apps" label="Back to all apps" />
```

Navigation, in chrome only. It is two lattice leaves on a high container, with
the nameplate mounted on it. Reaching for it parts the leaves. The room you are
in stands open on the primary container.

### 札 Chip — a stated fact

A word on the highest container, 8px corners, a 13px label. Colour appears only
where it carries a consequence, and a word always sits beside it: running is
the tertiary container, wants is suō, a 4xx is the primary container, and a 5xx
is urushi.

## The shared parts

An app never draws its own version of these (`parts.tsx`, `page.tsx`):

| Part | What it is |
| --- | --- |
| `PageHeader` | The page's title in Mincho, a sentence, actions on the right; `back` puts the way back before the title. |
| `BackButton` / `.k-back` | The way back: 44px round, a chevron. A link that goes back takes the class and `<BackGlyph />`. |
| `SectionHeader` | Above every row or list: headline Mincho 22/27, a quiet count, and "See all". Never "Show all". |
| `Carousel` | Any row that scrolls sideways. Snaps per item; round arrows on a pointer screen, only at an end with more beyond it. `--k-carousel-pad` sets a gutter, `--k-carousel-arrow-top` centres the arrows on the pictures. |
| `Toast` / `useToast` | A word along the bottom, in inverse ink: 3.2s, or 6s when it offers something to press. |
| `SearchField` | A 48px field with a glass and ×. |
| `EmptyState` | Nothing here yet: a Mincho line, a sentence, at most one thing to do. |
| `Portrait` (portal) | Every face. `tint` sets the initial on the person's own colour where many faces sit together. |

A place that is always dark whatever the house is (Watch) adds `.k-night`, and
gets the night values of every role.

## Ink and wash

Kimono's marks are drawn by hand (`ink.ts`, `ink-marks.tsx`): a wobbly plum
brush outline over a watercolour wash, different every time but seeded so the
server and the browser agree. It draws blots behind row icons, portrait frames,
petals, the outline of a card that matters, and every small circle (status
dots, radio rings, checklist rings). **Controls, containers and text are never
brushed.** The brush is the personality, and the M3 roles stay underneath it.
The bar for a dialog, sheet or menu is the phone's appearance dialog (commit
`2043f86`).

## Identity

Every app's mark is generated, not drawn. `BloomMark` builds a sakura from the
app's own three colours and places the app's glyph at its centre, so a new app
gets an identity for free and no two blooms are alike.

```tsx
import { BloomMark } from "@kimono/ui";

<BloomMark identity={{ id: app.id, colors: app.colors }}>{glyph}</BloomMark>
```

The sign-in page keeps its sakura sun disc, seigaiha and colour folds.

## Hosting an app you didn't write

Kimono can't restyle Outline and doesn't try. When an app opens, Kimono owns
the frame and the crossing, then gets out of the way. It draws a 52px rail with
the door back, the app's bloom, its name, its reach and its address, and adds
nothing below it: no fonts, no colours, no chrome.

## Quality floor

Responsive down to a phone, a visible `:focus-visible`, `prefers-reduced-motion`
respected, `prefers-contrast` honoured, text contrast of at least 4.5:1 (3:1
for large or bold text of 24px and up), hit targets of at least 48px, and **no
state encoded by colour alone**: every stateful thing also changes form or
says a word.

## What was cut

A system is mostly a record of what it said no to.

- **The paper system** (ADR 0006): depth by edge weight, 0–2px corners,
  hairline enclosures, the 3px frame, paper grain, beige surfaces too close to
  tell apart, 12px labels, and accent rationed to specks.
- **Ornament at clip-art size**: the ema plaques, cords and tassels on Home,
  and the sun band on Home.
- **Objects doing a panel's work**: 提灯 chōchin, 木札 kifuda, 短冊 tanzaku,
  重箱 jūbako, 番付 banzuke, 絵巻 emaki, 屏風 byōbu, 枯山水 karesansui and
  床の間 tokonoma. Their layouts may return, but the objects don't.
- **A second palette** (Decision 0004): a semantic chip family, and an app's
  colour spread across its room.
- **Uncaused motion**: page fade-ups after a crossing, ambient petal drift,
  perpetual sways, arrival swings on load, and full-screen crossings.
- **The M3 round pill as a button.** The seal was preferred (2026-11-04).
