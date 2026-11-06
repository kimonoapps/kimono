/*
 * The artifact engine: one copy, for the website and the phone app. Kimono
 * serves these files at /ai/lib/<name> (apps/portal/src/app/ai/lib), and the
 * frame (frame.ts) loads them into every artifact.
 *
 *   kit.js   the components (charts, stats, tables, tabs, sliders…) and the
 *            scene engine (animations, 2D and 3D, written line by line)
 *   kit.css  the page an artifact sits on, in Kimono's colours
 *   three/   three.js for 3D scenes, pinned, from the portal's dependencies
 *   katex/   KaTeX, for maths written as $…$ (its script, styles and fonts)
 */

export type EngineFile = { /** Where it is, from this package's src/engine. */ file?: string; /** Or from node_modules. */ module?: string; type: string; cache: string };

/** Folders served whole from node_modules: the name's prefix, where they are, and the file kinds allowed. */
export const engineFolders: { prefix: string; module: string; types: Record<string, string> }[] = [
  { prefix: "katex/", module: "katex/dist/", types: { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" } },
];

export const engineFiles: Record<string, EngineFile> = {
  "kit.js": { file: "kit.js", type: "text/javascript; charset=utf-8", cache: "no-cache" },
  "kit.css": { file: "kit.css", type: "text/css; charset=utf-8", cache: "no-cache" },
  "three/three.module.min.js": { module: "three/build/three.module.min.js", type: "text/javascript; charset=utf-8", cache: "public, max-age=604800, immutable" },
};
