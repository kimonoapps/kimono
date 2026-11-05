"use client";

import { useId, type ReactNode, type SVGProps } from "react";
import { type BloomIdentityInput } from "./bloom-identity";
import { inkBloomMarkup } from "./ink-bloom";
import { cx } from "./cx";

export { createBloomIdentity, petalPath, veinPath, type BloomIdentity, type BloomIdentityInput } from "./bloom-identity";

/**
 * The one bloom renderer. Every mark an app shows — launcher tile, header
 * lockup, favicon — is this drawing at a different size. There is deliberately
 * no second one: two renderers is how the tile and the lockup drift apart.
 */
export function BloomMark({ identity: input, children, centre = 20, ...props }: SVGProps<SVGSVGElement> & {
  identity: BloomIdentityInput;
  children?: ReactNode;
  /** Radius of the heart. Larger leaves room for a glyph. */
  centre?: number;
}) {
  const unique = useId().replaceAll(":", "");
  /* Drawn in ink and wash by the same function the server uses (bloom-svg.ts). */
  return <svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
    <g dangerouslySetInnerHTML={{ __html: inkBloomMarkup(input, centre, unique) }}/>
    {/* The glyph is brushed too: the bloom's fine ink wobble, inside the heart. */}
    <g className="app-bloom-glyph" clipPath={`url(#bloom-centre-clip-${unique})`}><g filter={`url(#ink-fine-${unique})`}>{children}</g></g>
  </svg>;
}

/** Reusable Kimono sakura mon. The five petals share one geometry and the
 * centre uses a folded collar motif, so it stays recognisable from favicon to hero. */
export function SakuraMon({ className = "" }: { className?: string }) {
  const inkId = `sakura-ink-${useId().replaceAll(":", "")}`;
  const petals = [0, 72, 144, 216, 288];

  return (
    <svg className={cx("sakura-mon", className)} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <defs>
        <filter id={inkId} x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency=".035 .09" numOctaves="2" seed="17" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale=".7" />
        </filter>
      </defs>
      <g filter={`url(#${inkId})`}>
        {petals.map((rotation) => (
          <g key={rotation} transform={`rotate(${rotation} 50 50)`}>
            <path className="sakura-mon-petal-shadow" d="M50 47 C36 39 31 21 41 10 C45 5 50 3 50 3 C50 3 56 5 60 10 C70 21 64 39 50 47Z" />
            <path className="sakura-mon-petal" d="M50 45 C39 38 34 23 42 13 C45 9 48 7 50 6 C52 7 55 9 58 13 C66 23 61 38 50 45Z" />
            <path className="sakura-mon-vein" d="M50 41 C48 30 49 19 50 10" />
          </g>
        ))}
      </g>
      <circle className="sakura-mon-centre" cx="50" cy="50" r="12" />
      <path className="sakura-mon-collar" d="M42 45 L50 52 L58 45 L55 59 L50 64 L45 59Z" />
      <circle className="sakura-mon-dot" cx="50" cy="50" r="2.5" />
    </svg>
  );
}

/**
 * Kimono's own mark: the ink branch drawn as one solid form, in whatever colour
 * the surrounding text is. It is inline SVG rather than an image so the header
 * and the sign-in page cannot drift apart — both render this, at any size.
 */
export function KimonoBranch({ className = "" }: { className?: string }) {
  const petals = [0, 72, 144, 216, 288];
  const petal = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z";
  return (
    <svg className={cx("kimono-branch", className)} viewBox="1 12 111 106" fill="currentColor" aria-hidden="true">
      <path d="M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z" />
      <path d="M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z" />
      <path d="M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z" />
      <g transform="translate(83 41) scale(.55) translate(-50 -50)">
        {petals.map((rotation) => <path key={rotation} d={petal} transform={`rotate(${rotation} 50 50)`} />)}
        <circle cx="50" cy="50" r="13" />
      </g>
    </svg>
  );
}

/** The product lockup: the mark, and the name beside it. */
export function KimonoMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cx("kimono-mark", compact && "kimono-mark-compact")} aria-label="Kimono">
      <span className="kimono-mark-symbol"><KimonoBranch /></span>
      {!compact ? <span className="kimono-mark-word">kimono</span> : null}
    </span>
  );
}
