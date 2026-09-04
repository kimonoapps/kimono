# ADR 0001: Kimono applications use tiered integration

- Status: Accepted for the initial scaffold
- Date: 2026-08-04

## Context

Kimono should make household applications feel like one product while still
allowing mature upstream software and independently deployed Docker containers.
A permanent portal header around an iframe appears to offer consistency without
modifying each application, but that consistency is mostly visual.

Cross-origin frames introduce brittle session behavior, require upstream apps to
permit embedding, complicate deep links and browser history, and create special
handling for downloads, fullscreen content, file pickers, accessibility, and
mobile layouts. They also require deliberate clickjacking controls.

## Decision

Kimono applications are standalone pages by default. Native applications and
maintained forks consume the shared app shell. Headless integrations use a
Kimono-owned frontend over an existing engine. Connected applications use SSO
and the closest safe branding or navigation hook that upstream supports.

The registry records two separate ideas:

- `kind`: `native`, `fork`, `connected`, or `hosted`
- `presentation`: `standalone` or `embedded`
- `brand.colors`: three app-owned colors rendered by the shared bloom mark

Embedding is an opt-in capability for small, trusted applications with an
explicit embed mode. It is not an integration strategy. An embedded app must
define its allowed parent with CSP, use a constrained iframe sandbox and
permissions policy, and document its authentication and navigation behavior.

## Consequences

- Moving between applications may perform a normal page navigation.
- The shared identity, launcher, account menu, tokens, typography, and behavior
  make navigation coherent without forcing every app into one browser document.
- Forks must integrate the Kimono shell directly to claim a native experience.
- Apps that cannot support the contract remain honestly labeled as connected.
- Hosted applications keep their upstream UI and account model while Kimono
  owns their lifecycle, storage, routing, and launcher identity.
- Kimono Notes is the first connected application: Outline owns the notes UI
  and storage while Kimono provides deployment, OIDC SSO, branding, and launch.
- A future cross-app bridge may use a versioned `postMessage` protocol, but it
  will not be invented until a real embedded application requires it.
