import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

const config: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },

  async rewrites() {
    return [
      {
        source: "/sitemap.xml",
        destination: "https://crawled-sitemap.vercel.sh/chat-sdk.dev-.xml",
      },
    ];
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
        destination: "/adapters/official/google-chat",
        permanent: true,
      },
      {
        source: "/adapters/community/matrix",
        destination: "/adapters/vendor-official/matrix",
        permanent: true,
      },
      {
        source: "/adapters/community/imessage",
        destination: "/adapters/vendor-official/imessage",
        permanent: true,
      },
      {
        source: "/adapters/community/resend",
        destination: "/adapters/vendor-official/resend",
        permanent: true,
      },
      {
        source: "/adapters/community/zernio",
        destination: "/adapters/vendor-official/zernio",
        permanent: true,
      },
      {
        source: "/adapters/community/liveblocks",
        destination: "/adapters/vendor-official/liveblocks",
        permanent: true,
      },
      {
        source: "/adapters/community/sendblue",
        destination: "/adapters/vendor-official/sendblue",
        permanent: true,
      },
      {
        source: "/docs/adapters/:slug+",
        destination: "/adapters",
        permanent: true,
      },
      {
        source: "/docs/state",
        destination: "/docs/state-adapters",
        permanent: true,
      },
      {
        source: "/docs/state/:slug+",
        destination: "/adapters",
        permanent: true,
      },
      {
        source: "/adapters/for/:slug*",
        destination: "/adapters",
        permanent: true,
      },
      {
        source:
          "/adapters/:slug((?!official$|community$|vendor-official$|official/.*|community/.*|vendor-official/.*).+)",
        destination: "/adapters",
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
