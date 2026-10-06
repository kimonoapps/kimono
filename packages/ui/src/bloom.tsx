"use client";

import { useId, type ReactNode, type SVGProps } from "react";
import { accentRamp } from "./accent";
import { cx } from "./cx";

/** An app is an id and one colour. Everything visual comes from those two. */
export type BloomIdentityInput = {
  id: string;
  accent: string;
};

export type BloomIdentity = {
  seed: number;
  rotation: number;
  centre: string;
  centreShadow: string;
  textureSeed: number;
  textureScale: number;
  petals: Array<{
    start: string;
    middle: string;
    end: string;
    rotation: number;
    scale: number;
    opacity: number;
  }>;
};

/**
 * Wraps an app-supplied palette in Kimono's bloom shell. The app owns its
 * colors and centre artwork; this function owns consistent petal rendering.
 */
export function createBloomIdentity(input: BloomIdentityInput): BloomIdentity {
  const ramp = accentRamp(input.accent);
  const seed = hashString(`${input.id}:${input.accent}`);
  const random = mulberry32(seed);
  const rotation = -5 + random() * 10;
  const petals = Array.from({ length: 5 }, (_, index) => {
    /* Alternating petals swap tint and body, so a single colour still reads
       as a flower with depth rather than five identical blades. */
    const reversed = index % 2 === 1;
    return {
      start: reversed ? ramp.soft : ramp.tint,
      middle: reversed ? ramp.tint : ramp.soft,
      end: ramp.deep,
      rotation: index * 72 + (random() - .5) * 2.8,
      scale: .965 + random() * .055,
      opacity: .94 + random() * .06,
    };
  });

  return {
    seed,
    rotation,
    centre: "var(--k-plum, #4e2b37)",
    centreShadow: "var(--k-plum, #4e2b37)",
    textureSeed: 1 + seed % 97,
    textureScale: .42 + random() * .32,
    petals,
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

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
  const identity = createBloomIdentity(input);
  const textureId = `bloom-texture-${unique}`;
  const centreClipId = `bloom-centre-clip-${unique}`;

  return <svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
    <defs>
      {identity.petals.map((petal, index) => <linearGradient key={index} id={`bloom-gradient-${unique}-${index}`} x1="20" y1="12" x2="78" y2="90" gradientUnits="userSpaceOnUse"><stop stopColor={petal.start}/><stop offset=".5" stopColor={petal.middle}/><stop offset="1" stopColor={petal.end}/></linearGradient>)}
      <filter id={textureId} x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency=".03 .075" numOctaves="2" seed={identity.textureSeed} result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale={identity.textureScale}/></filter>
      <clipPath id={centreClipId}><circle cx="50" cy="50" r={centre - 1}/></clipPath>
    </defs>
    <g filter={`url(#${textureId})`} className="app-bloom-petals" transform={`rotate(${identity.rotation} 50 50)`}>
      {identity.petals.map((petal, index) => <path key={index} d="M50 46 C37 38 32 21 41 10 C45 5 50 3 50 3 C55 5 58 8 61 12 C68 23 62 38 50 46Z" transform={`rotate(${petal.rotation} 50 50) translate(50 50) scale(${petal.scale}) translate(-50 -50)`} fill={`url(#bloom-gradient-${unique}-${index})`} opacity={petal.opacity}/>)}
      {identity.petals.map((petal, index) => <path key={`h${index}`} className="app-bloom-vein" d="M50 41 C49 29 49 18 50 8" transform={`rotate(${petal.rotation} 50 50)`}/>)}
    </g>
    <circle className="app-bloom-centre-shadow" cx="50" cy="50" r={centre + 3} style={{ fill: identity.centreShadow }}/>
    <circle className="app-bloom-centre" cx="50" cy="50" r={centre} style={{ fill: identity.centre }}/>
    <g className="app-bloom-glyph" clipPath={`url(#${centreClipId})`}>{children}</g>
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
      <path d="M57 73 C56 63 53 54 47 47 L50 44 C57 52 60 62 61 72Z" />
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
