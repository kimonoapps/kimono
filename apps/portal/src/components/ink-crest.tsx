import { useId, type CSSProperties } from "react";
import { crestSvg } from "@kimono/ui/crest";

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
