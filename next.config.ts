import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a verification build (NEXT_DIST_DIR=.next-verify) run without corrupting a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["pg"],
  devIndicators: false,
  // The consent and approval pages grant payments; no other site may frame them to trick a click.
  async headers() {
    const noFraming = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      { source: "/oauth/:path*", headers: noFraming },
      { source: "/approve/:path*", headers: noFraming },
    ];
  },
};

export default nextConfig;
