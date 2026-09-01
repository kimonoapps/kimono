# 型 Kata — the Kimono design system

Kimono's interface is built from three materials, four depths, and three
interaction primitives. This document is the contract; `packages/ui/src/kata.css`
is the enforcement. If something on screen is not described here, it is a bug or
it is decoration — and decoration is not in the system.

The specimen sheets these rules were cut from live in `design/specimens/`, and
the workflow that produced them is `.claude/skills/katagami/SKILL.md`.

## The three materials

Every surface is **paper**, every mark is **ink**, every physical object is
**wood**. Signal colours are applied to those materials; they are never
materials themselves.

| Role | Token | Value |
| --- | --- | --- |
| ink | `--k-ink` | `#24221f` |
| ink, softened | `--k-ink-soft` | `#5b524d` |
| ink, faint | `--k-faint` | `#8b6d67` |
| paper, the ground | `--k-ground` | `#faf7f1` |
| paper, a sheet | `--k-sheet` | `#fffdf8` |
| paper, a hairline | `--k-hair` | `#ded0be` |
| wood | `--k-wood` | `#d8b77f` |
| wood, pale | `--k-wood-pale` | `#ead2aa` |
| accent (蘇芳) | `--k-accent` | `#a84d63` |
| accent, pale (桜色) | `--k-accent-pale` | `#f2cbd2` |
| moss | `--k-moss` | `#5c7150` |

Two rules that are not negotiable:

- **Accent is never decoration.** It marks a thing that wants you, or an action
  you can take. If a surface is accented and nothing is being asked of the
  reader, the accent is wrong.
- **Moss means running**, and nothing else.

## Depth is edge weight

Paper stacks; it does not glow. There are no blurred shadows anywhere in Kimono
chrome. Depth is carried by edges, and the rule that assigns them is **can I
touch this**.

| Weight | Token | Meaning |
| --- | --- | --- |
| `3px` frame | `--k-frame` | The outer boundary of a workspace. **One per region.** |
| `2px` rule | `--k-rule` | Anything you can touch, and the seams between compartments. |
| `1px` hairline | `--k-hairline` | Passive division inside a compartment. Separates, never encloses. |

A tray may carry one hard offset shadow (`6px 6px 0`). Never a blur.

A compartment's body is a **sheet**: it carries `--k-sheet` behind it, so a card
reads as paper laid on the ground rather than a region drawn only with lines.
Anything inside it may therefore be plain — an address, a note — and only a
thing you act on, like a command, marks itself further.

### 組 Kumi — composition

- **Frames never nest.** A region inside a region is a compartment, not a frame.
- **Edges are shared, never doubled.** Adjacent compartments meet on one seam.
- **A hairline never touches a frame.** If they would meet, drop the hairline.
- **A grid of free-standing items is sheets with hairlines.** Six frames is a
  fence: each claims to be the outermost boundary, so none of them is.

## Type

Three roles, seven sizes, nothing between them.

- **Mincho (`--k-display`) names things** — pages, apps, and the one sentence
  that matters. Never body copy.
- **Sans (`--k-sans`) does the work** — labels, controls, running text.
- **Mono (`--k-mono`) is only ever an address or a number.**

`36 · 27 · 21` display, `16 · 14 · 12.5` sans, `11` mono.

## Ma and motion

Spacing is `--k-ma-1`…`--k-ma-6`: **4 · 8 · 14 · 22 · 34 · 56**. Nothing between.

| Duration | Token | For |
| --- | --- | --- |
| 180ms | `--k-t-state` | hover, focus, press |
| 420ms | `--k-t-element` | a panel opening, a joint seating |
| 900ms+ | `--k-t-place` | a page change |

Easings are `--k-ease-in` for arriving and `--k-ease-out` for leaving.

**A place change must cover completely before it swaps.** Half-covered swaps are
visible, and a visible swap is the thing transitions exist to hide.

**The press starts the load; the cover decides when it is seen.** Reaching for a
door warms its destination and pressing it begins the fetch, so the crossing is
spent on a page already on its way rather than on a wait that has not started.
The page changes hands at full cover. If it is not there yet the crossing holds
exactly there — covered, motionless — and plays out its second half only once
the page is standing. A duration is how long a crossing takes when the page is
ready, never a promise that it will be. The screen waits for the page; the page
never arrives behind an open screen.

> Three CSS traps this system has already hit, all worth knowing. A timing
> function on the `animation` shorthand is re-applied *between every pair of
> keyframes*, so multi-stop animations need per-keyframe
> `animation-timing-function` or they lurch. A keyframe that sets only
> `opacity` still splits the `transform` timeline — animate the two as separate
> animations. And the `animation` shorthand carries `animation-play-state`, so
> it resets a longhand `paused` set elsewhere: the rule that holds a crossing
> at full cover has to be marked `!important` to survive it.

## 動 Dō — what may move, and why

Kimono is made of paper, ink, wood and cloth. **None of those things fade in or
float up.** Motion in this system is always a material behaving like itself:
paper slides and folds, wood swings and seats, ink stamps and dries, cloth
sways. Nothing scales, nothing blurs, nothing fades.

Three rules decide whether an animation may exist.

**1. Motion must be caused.** Something moves only because of your pointer or
keyboard on a control, a crossing, or the system changing state — an app
starting, a backup finishing. There is no ambient motion. Anything that loops
forever without a cause is decoration, and decoration is not in the system.

**2. One event, one motion.** If a crossing covered a page change, the arriving
page does **not** animate. The crossing *is* the arrival. A page that fades up
after being uncovered is the same event animated twice, and it reads as lag.

**3. Motion is in the material's own plane.** A screen slides sideways because
that is how a screen moves. A joint seats along its axis. A blind unrolls
downward. Nothing travels along an axis its material could not.

Durations remain the three above: `--k-t-state`, `--k-t-element`, `--k-t-place`.
There is no fourth.

### What this ruled out

| Removed | Why |
| --- | --- |
| page-enter fade-up on admin pages | the crossing already delivered the page; rule 2 |
| ambient petal drift on the home hero | uncaused; and it spent the crossing's material on wallpaper |
| the account yoke's perpetual sway | uncaused loop |
| the launcher plaques' arrival swing | fires on load, which is not one of the three causes |

Petals are now reserved for 花吹雪. When you see blossom, you are crossing
between apps — it means something, because it does not happen otherwise.

## The three primitives

Every interactive thing in Kimono is one of these. **If a need does not fit, it
is text and a seal — not a new object.** That rule is what keeps the vocabulary
from becoming a menagerie again.

### 障子 Door — goes somewhere

```tsx
import { Door } from "@kimono/ui";

<Door href="/admin/apps" label="Back to all apps" />
```

Navigation only, and only in chrome. A door never appears inside content. Its
leaves part on hover and slide fully open on activation.

### 継手 Joint — turns something on or off

```tsx
import { Joint } from "@kimono/ui";

<Joint checked={on} onChange={setOn} label="Run this application" profile="aikaki" />
```

The only switch in the system. Apart is off, seated is on. The **profile is a
promise about the setting**, not decoration:

| Profile | Joint | Says |
| --- | --- | --- |
| `ari` | dovetail | cannot be drawn back out — for something meant to stay on |
| `hozo` | tenon | a plain, neutral connection |
| `aikaki` | half-lap | the pieces merely overlap — for something you expect to flip |

### 判 Seal — commits an action, or states a fact

```tsx
import { Seal, StatedSeal } from "@kimono/ui";

<Seal type="submit">Save app setup</Seal>
<StatedSeal state="running">Running</StatedSeal>
```

One object, two uses. Pressed, it commits. Stamped, it labels a state:
`running` · `private` · `wants` · `quiet`.

## Identity

Every app's mark is **generated, not drawn**. `BloomMark` builds a sakura from
the app's own three colours and places the app's glyph at its centre, so a new
app gets an identity for free and no two blooms are alike.

```tsx
import { BloomMark } from "@kimono/ui";

<BloomMark identity={{ id: app.id, colors: app.colors }}>{glyph}</BloomMark>
```

## Hosting an app you did not write

Kimono cannot restyle Outline and should not try. At the moment an app opens,
the system owns **the frame and the crossing**, then gets out of the way. Kimono
draws a 52px rail — the door back, the app's bloom, its name, its reach, its
address — and contributes nothing below it. No fonts, no colours, no chrome.

## Quality floor

Responsive to mobile, visible `:focus-visible`, `prefers-reduced-motion`
respected, text contrast at least 4.5:1 (3:1 for large or bold ≥24px), hit
targets ≥44px, and **no state encoded by colour alone** — every stateful thing
also changes form.

## What was cut

A system is mostly a record of what you said no to. These were proposed,
prototyped, and rejected: 提灯 chōchin, 木札 kifuda, 短冊 tanzaku, 重箱 jūbako,
番付 banzuke, 絵巻 emaki, 屏風 byōbu, 枯山水 karesansui, 床の間 tokonoma — nine
objects doing work that panels, rules and seals already do. 暖簾 noren survives
only as a transition skin, never as a card.

Their *layouts* may return. The objects do not.
