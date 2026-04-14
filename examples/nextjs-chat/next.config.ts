import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "chat",
    "@chat-adapter/slack",
    "@chat-adapter/state-memory",
    "@chat-adapter/state-redis",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Externalize discord.js and its native dependencies for serverless compatibility
  serverExternalPackages: [
    "discord.js",
    "@discordjs/ws",
    "@discordjs/voice",
    "zlib-sync",
    "bufferutil",
    "utf-8-validate",
  ],
  turbopack: {
    root: "../..",
  },
};

export default withWorkflow(nextConfig);
