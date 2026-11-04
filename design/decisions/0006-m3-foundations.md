# ADR 0006: Material 3 foundations, Kata personality

- Status: Proposed
- Date: 2026-11-04
- Sheet: `specimens/11-m3-foundations.html`

## Context

The phone app (`apps/compose`) runs on Material 3 Expressive, seeded from suō.
The owner says it has "a great mix of personality and Material 3". By contrast,
the website "feels super cheap". The two share colours, type and the bloom, so
the gap is in the foundations underneath them:

- **Scale.** Web body text is 14px and most labels are 12–13px. `600 12px` is
  the most common font in the Portal. The phone uses 16px body and 13px bold
  labels.
- **Shape.** The web uses 0–2px corners and a 1px hairline around most boxes.
  An unstyled admin page looks the same way. The phone uses round shapes,
  fills, and no outlines.
- **Surface.** Paper tones (`#fbf7ef`, `#f7f1e8`, `#ebe2d3`) plus a grain are too
  close to tell apart, so hierarchy falls to hairlines. The phone steps from a
  near-white surface to pink and beige containers that are clearly apart.
- **Colour.** "Accent is never decoration" leaves web pages beige with specks
  of suō. The phone's warmth comes from soft suō containers.
- **Personality.** On the web, personality is small ornament: the carved ring,
  ema plaques, cords and tassels. At those sizes they read as clip art. On the
  phone it is behaviour: shapes that morph when pressed, wavy progress, and
  petals that pile up as you hold.

The owner chose M3 foundations while keeping Kata's personality.

## Decision

The web takes its **foundations** from the phone theme (`Kata.kt`):

- the tonal colour roles: surface, the five surface containers, primary,
  secondary and tertiary with their containers, and outline;
- the type scale, with 16px body and Mincho from title up;
- M3's corner scale for containers, sheets, rows and chips;
- expressive spring motion.

It keeps Kata's **personality**, which is mechanics and art:

- Shippori Mincho with Zen Maru Gothic (ADR 0005);
- suō, plum and moss as the only hues;
- blooms and the sakura crossing;
- the **hanko seal** as the button. It keeps its carved ring and its base,
  and it sinks onto that base when pressed. Material supplies its colours,
  48px height and 15px label. The owner preferred it over M3's round pill
  (2026-11-04). A 2px cut and an 8px cut are both on the sheet;
- hold-to-confirm with petals;
- the joint switch and the shoji door transition;
- the sun-disc login art.

Decision 0004's rule still stands: **no second palette**. Tonal roles are all
drawn from the suō, plum and moss family, and state is never given a hue of
its own.

## Consequences

- `docs/design-system.md` sections on depth-by-edge, 0–2px radii and
  rationed accent are superseded once this is accepted.
- The following go: hairline enclosures, paper grain, and the ema, cord and
  tassel ornaments.
- The 2026-10-05 "no generic pills" ruling still holds for buttons. Only
  containers become round.
- The Authentik sign-in page is part of the pass. It currently shows
  Authentik's default page in local development.
