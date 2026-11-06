import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kimono/ui", "@kimono/app-sdk", "@kimono/account", "@kimono/artifacts"],
  /* The artifact engine is served from its package, and three.js and KaTeX from here (app/ai/lib).
     Those two are named where pnpm keeps them: the build doesn't follow the links in node_modules.
     The key is a glob, so not the route's own name: its [...path] would be read as a set of characters. */
  outputFileTracingIncludes: { "/ai/lib/**": [
    "../../packages/artifacts/src/engine/*",
    "../../node_modules/.pnpm/three@*/node_modules/three/build/three.module.min.js",
    "../../node_modules/.pnpm/katex@*/node_modules/katex/dist/**",
  ] },
  /* Pages move between each other with the browser's view transitions (components/page-transition.tsx). */
  experimental: {
    viewTransition: true,
    /* Links fetch their whole page on hover (components/crossing.tsx). A page
       fetched that way is reused for 30 seconds at most, so a quick press is
       instant and a later one is never more than half a minute stale. */
    staleTimes: { static: 30 },
  },
};

export default nextConfig;
