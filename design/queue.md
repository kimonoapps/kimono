# Element queue

One class in flight at a time. Order runs smallest-commitment to largest, so the
vocabulary is proven on cheap elements before it carries a whole page.

| # | Element class | Status | Sheet | Decision |
| --- | --- | --- | --- | --- |
| 1 | Buttons — primary, secondary, destructive, toggle | Awaiting verdict | `specimens/01-buttons.html` | — |
| — | **Palette** (out of band) | Awaiting verdict | `specimens/02-palette.html` | — |
| 7 | **Page transitions** (pulled forward) | **Kept — all six** | `specimens/04-in-page.html` | — |
| 2 | **Cards and apps** (pulled forward) | Awaiting verdict | `specimens/05-cards.html` | — |
| — | **Information inside an app** | Awaiting verdict | `specimens/06-information.html` | — |
| — | **Dashboards** | Awaiting verdict | `specimens/07-dashboard.html` | — |
| — | **Type** (out of band) | **Cut — Shippori Mincho with Zen Maru Gothic** | `specimens/10-type.html` | `decisions/0005-type.md` |
| 3 | Links and underlines | Queued | — | — |
| 3 | Text inputs, selects, checkboxes | Queued | — | — |
| 4 | Containers — panels, compartments, disclosure | Queued | — | — |
| 5 | Navigation — sections, back, breadcrumb | Queued | — | — |
| 6 | State and feedback — status, notices, empty, loading | Queued | — | — |


**Status values:** Queued → In flight → Verdict in → Cut (decision written).

After class 4 is cut, run a **proof page** (Stage 4) before continuing. The
admin app detail page is the intended proof: it already exercises buttons,
links, inputs, containers, and state in one screen.

## Sheet 01 verdicts

| # | Specimen | Verdict | Note |
| --- | --- | --- | --- |
| 03 | Shoji | **Kept** | Nameplate for legibility; lattice loosened to 36px. Two-stage open: a crack at 190ms, easing to 38% after 400ms. Full slide-off was too much. |
| 04 | Tsugite | **Kept — as the switch** | A joint has two resting states, so it was never a button. Apart is off, seated is on; `role="switch"`. Profile still open: ari / hozo / aikaki. |

| 12 | Hold | **Kept, adjusted** | Ink progress bar replaced with sakura petals piling up over 1.4s. Release early and they scatter. |

| — | Transitions | **Kept — all six** | 花吹雪 / 障子 / 暖簾 / 掛軸 / 墨 / 襖. 障子 is the header door, not a picker option. Cross-site mode covers the header. |

Remaining specimens have no verdict yet. See "The press is the transition" in
`motifs.md` — the owner's observation that these controls are slow enough to
*be* the page transition, which reframes element class 7.
