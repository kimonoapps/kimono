import { createBloomIdentity, petalPath, veinPath, type BloomIdentityInput } from "./bloom-identity";
import { brushAttributes, inkFilters, inkRandom, mixHex, washGradient } from "./ink";

/*
 * An app's bloom in ink and wash: the same five petals, rotation and colours
 * as before, each petal washed in the app's colour and outlined with a broken
 * plum brush; the heart is a pool of ink. Seeded by the app, so the website,
 * the server and the phone draw the very same flower.
 *
 * Returns everything inside the bloom's <svg> except the glyph, which the
 * caller adds clipped to `bloom-centre-clip-${unique}`.
 */
export function inkBloomMarkup(input: BloomIdentityInput, centre: number, unique: string) {
  const identity = createBloomIdentity(input);
  const random = inkRandom(identity.seed ^ 0x51ed);
  const gradients: string[] = [], petals: string[] = [];
  identity.petals.forEach((petal, index) => {
    const id = `bloom-wash-${unique}-${index}`;
    gradients.push(washGradient(id, mixHex(petal.start, "#ffffff", .35), mixHex(petal.middle, "#ffffff", .25), petal.end));
    const scale = (petal.scale * (.97 + random() * .06)).toFixed(3);
    petals.push(`<g transform="rotate(${petal.rotation.toFixed(2)} 50 50) translate(50 50) scale(${scale}) translate(-50 -50)">`
      + `<path d="${petalPath}" fill="url(#${id})" filter="url(#ink-wash-${unique})" opacity="${petal.opacity.toFixed(2)}"></path>`
      + `<path d="${petalPath}" ${brushAttributes(random, unique, .75)}></path>`
      + `<path d="${veinPath}" fill="none" stroke="${petal.end}" stroke-width="1" stroke-linecap="round" opacity=".4" filter="url(#ink-fine-${unique})"></path></g>`);
  });
  const heart = (centre * (.96 + random() * .08)).toFixed(1);
  return `<defs>${inkFilters(unique, identity.textureSeed)}${gradients.join("")}<clipPath id="bloom-centre-clip-${unique}"><circle cx="50" cy="50" r="${centre - 1}"></circle></clipPath></defs>`
    + `<g transform="rotate(${identity.rotation.toFixed(2)} 50 50)">${petals.join("")}</g>`
    + `<circle cx="50" cy="50" r="${heart}" fill="#3a2128" filter="url(#ink-wash-${unique})"></circle>`
    + `<circle cx="50" cy="50" r="${centre}" ${brushAttributes(random, unique, .7)}></circle>`;
}
