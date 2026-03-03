import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

const config: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },

  async redirects() {
    return [
      {
        source: "/docs/contributing",
        destination: "/docs/contributing/building",
        permanent: true,
      },
      {
        source: "/marketplace",
        destination: "/adapters",
        permanent: true,
      },
      {
        source: "/adapters/gchat",
        destination: "/adapters/google-chat",
        permanent: true,
      },
      {
        source: "/docs/adapters/:slug",
        destination: "/adapters/:slug",
        permanent: true,
      },
      {
        source: "/docs/state/:slug",
        destination: "/adapters/:slug",
        permanent: true,
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
};

export default withMDX(config);
