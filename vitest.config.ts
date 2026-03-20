import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/chat",
      "packages/adapter-discord",
      "packages/adapter-gchat",
      "packages/adapter-github",
      "packages/adapter-linear",
      "packages/adapter-shared",
      "packages/adapter-slack",
      "packages/adapter-teams",
      "packages/adapter-telegram",
      "packages/adapter-twitter",
      "packages/adapter-whatsapp",
      "packages/state-ioredis",
      "packages/state-memory",
      "packages/state-redis",
    ],
  },
});
