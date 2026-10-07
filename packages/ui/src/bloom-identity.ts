import { accentRamp } from "./accent";

/*
 * The bloom's geometry and colour, with no renderer attached. The Portal draws
 * it as DOM SVG and the phone app as native SVG; both read these numbers, so a
 * bloom is the same flower wherever it appears.
 */

export const petalPath = "M50 46 C37 38 32 21 41 10 C45 5 50 3 50 3 C55 5 58 8 61 12 C68 23 62 38 50 46Z";
export const veinPath = "M50 41 C49 29 49 18 50 8";

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
