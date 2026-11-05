import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kimono/ui", "@kimono/app-sdk", "@kimono/account"],
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
