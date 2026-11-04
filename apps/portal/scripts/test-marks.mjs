import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/* The website's own components, compiled from source as they are, with the TypeScript the Portal builds with. */
const source = new URL('../../../packages/ui/src/', import.meta.url);
/* Inside the Portal, so the compiled files find its React. */
const out = new URL('../node_modules/.cache/kimono-marks/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const file of ['bloom.tsx', 'bloom-identity.ts', 'accent.ts', 'cx.ts', 'glyphs.tsx', 'bloom-svg.ts', 'ink.ts', 'ink-bloom.ts']) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, source), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  writeFileSync(join(out, file.replace(/\.tsx?$/, '.mjs')), outputText.replace(/from "(\.\/[^"]+)"/g, 'from "$1.mjs"'));
}
const { BloomMark } = await import(join(out, 'bloom.mjs'));
const { Glyph } = await import(join(out, 'glyphs.mjs'));
const { bloomSvg } = await import(join(out, 'bloom-svg.mjs'));

/* React picks its own ids; name them alike before comparing. */
function sameIds(svg) {
  const unique = svg.match(/id="bloom-centre-clip-([^"]+)"/)[1];
  return svg.split(unique).join('ID');
}

const apps = [
  { id: 'notes', accent: '#c47b2b', glyph: 'notes' },
  { id: 'photos', accent: '#3f6fb5', glyph: 'image' },
  { id: 'kimono-drive', accent: '#5f5596', glyph: 'file' },
  { id: 'kimono-vpn', accent: '#2f6b7a', glyph: 'mesh' },
  { id: 'kimono-portal', accent: '#d77b8c', glyph: 'bloom' },
];

for (const app of apps) {
  for (const [centre, scale] of [[20, .72], [15, .5]]) {
    test(`the API's bloom is the website's: ${app.id} at heart ${centre}`, () => {
      const website = renderToStaticMarkup(createElement(BloomMark, { identity: app, centre }, createElement(Glyph, { name: app.glyph, scale, color: '#fffdf8' })));
      assert.equal(sameIds(bloomSvg(app, { centre, glyph: app.glyph, glyphScale: scale, unique: 'q7zx' })), sameIds(website));
    });
  }
}

test('a standalone bloom carries its ink with it', () => {
  const svg = bloomSvg(apps[0], { glyph: 'notes', standalone: true });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /class=|var\(/);
  assert.match(svg, /<filter id="ink-wash-/);
  assert.match(svg, /stroke="#4e2b37"/);
});
