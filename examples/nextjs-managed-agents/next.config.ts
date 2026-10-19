import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Cursor SDK loads parts of itself and native binaries at runtime,
  // so it must not be bundled.
  serverExternalPackages: ["@cursor/sdk"],
  turbopack: {
    root: "../..",
  },
};

export default nextConfig;
