import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kimono/ui", "@kimono/app-sdk", "@kimono/account"],
};

export default nextConfig;
