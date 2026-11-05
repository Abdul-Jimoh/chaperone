import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a verification build (NEXT_DIST_DIR=.next-verify) run without corrupting a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["pg"],
  devIndicators: false,
};

export default nextConfig;
