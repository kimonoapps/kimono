import { useId, type CSSProperties } from "react";
import { BloomMark } from "@kimono/ui";
import { crestFlowerMarkup, crestHex, crestSvg } from "@kimono/ui/crest";

/* FNV-1a, as the ink marks seed themselves, so a mark is the same on every screen. */
function seedOf(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/**
 * 紋 A crest washed in its colour, as a notebook's or a space's mark. Each
 * one is turned by its own seed (the thing's id), so two notebooks with the
 * same crest still read as two, and a notebook looks the same everywhere:
 * the turn is fnv1a(seed) mod 360 degrees.
 */
export function InkCrest({ crest, color, seed, size = 24, className }: { crest: string; color: string; seed: string; size?: number; className?: string }) {
  const style = { "--crest-size": `${size}px`, "--crest-turn": `${seedOf(seed) % 360}deg` } as CSSProperties;
  /* Its own ids: a copy whose defs sit in a hidden panel would otherwise leave this one unpainted. */
  const own = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svg = crestSvg(crest, color).replace(/crest-[a-z]+-[a-z]+/g, (id) => `${id}-${own}`);
  return <span className={["ink-crest", className].filter(Boolean).join(" ")} style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * 紋 A space's mark, drawn like an app's logo: its own bloom (seeded by the
 * space, washed in the crest's colour, plum brush round each petal) with the
 * crest's flower in paper white at the heart.
 */
export function SpaceBloom({ crest, color, seed, className }: { crest: string; color: string; seed: string; className?: string }) {
  const own = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const flower = crestFlowerMarkup(crest).replaceAll("__MASK__", `crest-mask-${own}`);
  return <span className={["k-app-bloom k-app-mark space-bloom", className].filter(Boolean).join(" ")} aria-hidden="true">
    <BloomMark className="k-app-bloom-flower" identity={{ id: `space-${seed}`, accent: crestHex(color) }} centre={19}>
      <g fill="#fffdf8" transform="translate(50 50) scale(.46) translate(-50 -50)" dangerouslySetInnerHTML={{ __html: flower }} />
    </BloomMark>
  </span>;
}
