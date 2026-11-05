import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kimono/ui", "@kimono/app-sdk", "@kimono/account"],
  /* Pages move between each other with the browser's view transitions (components/page-transition.tsx). */
  experimental: { viewTransition: true },
};

export default nextConfig;
