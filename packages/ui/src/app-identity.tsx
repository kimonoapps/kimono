"use client";

import { type CSSProperties, type ReactNode } from "react";
import { accentRamp } from "./accent";
import { BloomMark } from "./bloom";
import { Glyph, type GlyphName } from "./glyphs";
import { cx } from "./cx";

/**
 * 銘 Mei — how an app says who it is.
 *
 * Every app is declared the same way: a name and one accent. From that it gets
 * a bloom, a lockup and a header without anyone drawing anything. Building a
 * new app means writing an `AppIdentity` and rendering `AppHeader`; there is no
 * second way to do it, which is what keeps two apps from looking unrelated.
 */
export type AppIdentity = {
  /** Stable id — seeds the bloom, so the same app always grows the same one. */
  id: string;
  /** What the app is called after the Kimono wordmark: "VPN", "Notes". */
  name: string;
  /** The one colour the app owns. */
  accent: string;
  /** The mark at the centre of its bloom. Defaults to a blossom heart. */
  glyph?: GlyphName;
};

/**
 * An app's bloom. One drawing at two sizes: the launcher gives the glyph a
 * roomy heart, the lockup a tight one. Both go through the same renderer, so
 * a tile and a header can never show different flowers.
 */
export function AppBloom({ identity, size = "tile", glyphHref, className }: {
  identity: AppIdentity;
  size?: "tile" | "mark";
  /** A hosted app ships its own glyph file; Kimono's own name a built-in. */
  glyphHref?: string;
  className?: string;
}) {
  const roomy = size === "tile";
  const glyphSize = roomy ? "30%" : "22%";
  const externalGlyph = !identity.glyph && glyphHref;
  return <span className={cx("k-app-bloom", roomy ? "k-app-tile" : "k-app-mark", className)}>
    <BloomMark
      className="k-app-bloom-flower"
      identity={identity}
      centre={roomy ? 20 : 15}
    >
      {!externalGlyph ? <Glyph name={identity.glyph} scale={roomy ? .72 : .5} color="#fffdf8" /> : null}
    </BloomMark>
    {externalGlyph ? <img className="k-app-bloom-icon" src={externalGlyph} alt="" aria-hidden="true" draggable={false}
      style={{ width: glyphSize, height: glyphSize }} /> : null}
  </span>;
}

/**
 * The lockup: the app's own bloom, the Kimono wordmark, then the app's name in
 * its accent. Kimono states whose house it is; the bloom and the name state
 * which room — so no two apps arrive looking like each other.
 */
export function AppLockup({ identity, className }: { identity: AppIdentity; className?: string }) {
  return <span
    className={cx("k-app-lockup", className)}
    style={{ "--k-app-accent": accentRamp(identity.accent).deep } as CSSProperties}
    aria-label={`Kimono ${identity.name}`}
  >
    <span className="k-app-lockup-mark"><AppBloom identity={identity} size="mark" /></span>
    <span className="k-app-lockup-word">kimono</span>
    <b className="k-app-lockup-name">{identity.name}</b>
  </span>;
}

/**
 * An app's page header. The lockup on the left, whatever the app offers on the
 * right, and one sentence saying what this place is for.
 */
export function AppHeader({ identity, children, description }: {
  identity: AppIdentity;
  /** Seals and doors belonging to the app. */
  children?: ReactNode;
  description?: ReactNode;
}) {
  return <header
    className="k-app-header"
    style={{ "--k-app-accent": accentRamp(identity.accent).deep } as CSSProperties}
  >
    <div className="k-app-header-identity">
      <AppLockup identity={identity} />
      {description ? <p>{description}</p> : null}
    </div>
    {children ? <div className="k-app-header-actions">{children}</div> : null}
  </header>;
}

/** An app's own rooms, shown in its chrome beneath the lockup. */
export function AppRooms({ children }: { children: ReactNode }) {
  return <nav className="k-app-rooms" aria-label="Sections">{children}</nav>;
}
