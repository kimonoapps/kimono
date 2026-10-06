# Making a Kimono app

A first-party app — one Kimono writes, rather than one it hosts — is **one
registry entry and one page**. Everything visible is derived from the entry, so
two apps cannot end up looking unrelated and nobody draws artwork by hand.

## 1. Declare it

Add an entry to `apps/portal/src/lib/kimono-apps.ts`:

```ts
{
  id: "kimono-photos",
  name: "Kimono Photos",
  shortName: "Photos",
  description: "Every picture your household keeps.",
  path: "/photos",
  accent: "#4a6ea8",
  glyph: "image",
  requires: "mesh",   // omit when everyone gets it
}
```

Five fields decide the whole identity:

| Field | What it drives |
| --- | --- |
| `id` | seeds the bloom, so the app always grows the same flower |
| `shortName` | the word after the Kimono wordmark in the lockup |
| `accent` | the bloom, the app's name, anything the app marks |
| `glyph` | the mark at the centre of the bloom |
| `path` | where it lives, and where the launcher tile goes |

`accent` is a single colour. `accentRamp()` derives the petal tint, body, depth
and a legible contrast from it by pinning lightness rather than scaling it — a
pale accent and a dark one produce blooms with the same read.

Glyphs live in `packages/ui/src/glyphs.tsx`. Add one there if none fit; draw it
on the bloom's 100×100 field centred on (50, 50), with round even strokes,
because it is read at 20&nbsp;px.

## 2. Build the page

```tsx
import { Compartment, Note, Row, Rows } from "@kimono/ui";
import { identityOf, ownApp } from "@/lib/kimono-apps";

export default async function PhotosPage() {
  const identity = identityOf(ownApp("kimono-photos"));
  return <AppShell user={session.user} app={identity}>
    <div className="page admin-page">
      <header className="app-intro"><p>Every picture your household keeps.</p></header>
      <Compartment label="Albums">
        <Rows>{albums.map((album) => <Row key={album.id} title={album.name}>{album.count} photos</Row>)}</Rows>
      </Compartment>
    </div>
  </AppShell>;
}
```

Passing `app` makes the shell **wear the app**: its lockup replaces the Kimono
mark, the Portal's rooms step aside for one door back, and the accent is
published as `--k-app-accent` for the whole page. The page does not repeat the
identity — the chrome already said it.

## 3. Build the body from the system

Only these, and nothing hand-rolled:

- `Compartment` — a labelled region. Compartments carry no fill; depth is edges.
- `Rows` / `Row` — a hairline-divided list. One row, one thing, at most one action.
- `Note` — a muted aside. It states; it does not list.
- `Mono` — an address or a number, unadorned.
- `Command` — something to copy. Keeps its frame, because you act on it.
- `Steps` / `Step` — a sequence, when the order is the information.
- `Field` / `Form` / `FormActions` — a labelled control and its seals.
- `Seal` / `StatedSeal` / `Door` / `Joint` — the three primitives.

If a need fits none of them it is text and a seal, not a new object. That rule
is what stopped the cards drifting: every page that wrote its own row markup got
a slightly different card.

See [`design-system.md`](design-system.md) for the contract these implement.

## Mobile app tutorials

Add `spec.mobileApp` to an app definition to show a step-by-step tutorial when a mobile user opens the app:

```json
{
  "mobileApp": {
    "name": "Your mobile app",
    "guideUrl": "https://example.com/setup",
    "iosUrl": "https://apps.apple.com/app/example/id123456789",
    "androidUrl": "https://play.google.com/store/apps/details?id=com.example.app",
    "steps": [
      { "id": "download", "kind": "download", "title": "Download the app", "description": "Install the app, then return here." },
      { "id": "connect", "kind": "server", "title": "Connect to your server", "description": "Enter this address in the app." },
      { "id": "sign-in", "kind": "instruction", "title": "Sign in", "description": "Choose Sign in with Kimono." }
    ]
  }
}
```

Steps appear in manifest order. Each needs a unique `id`, a `title`, a `description`, and a `kind`: `download` shows OS-specific store buttons; `server` shows the current app address and a copy button; `instruction` shows the text alone. Store URLs are optional, but a download step requires at least one. All links must use HTTPS. iOS detection includes iPads using desktop mode; an unknown OS shows both available stores. Legacy string steps remain supported.

Next and Back move between steps. Skip opens the app in the browser from any step; the final action also opens the browser. Closing returns to the launcher, and reopening starts at step one. Downloads and the setup guide open in another tab so the tutorial stays available.

For other onboarding flows, import `Tutorial` and `TutorialStep` from `@kimono/ui`. Supply ordered steps (`id`, `title`, `description`, optional React `content`), `onClose`, `onSkip`, and `onComplete`. Optional `description`, `footer`, `skipLabel`, and `completeLabel` customize the flow. Mount it only while open, with a stable, nonempty steps array; use a React key to reset it when switching flows. The component owns progress, navigation, focus management, scroll locking, and the fallback for browsers without native dialog support.
