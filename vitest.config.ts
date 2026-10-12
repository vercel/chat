import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/catalog",
      "packages/chat",
      "packages/adapter-discord",
      "packages/adapter-gchat",
      "packages/adapter-github",
      "packages/adapter-gmail",
      "packages/adapter-instagram",
      "packages/adapter-linear",
      "packages/adapter-messenger",
      "packages/adapter-notion",
      "packages/adapter-shared",
      "packages/adapter-slack",
      "packages/adapter-teams",
      "packages/adapter-telegram",
      "packages/adapter-twilio",
      "packages/adapter-twitch",
      "packages/adapter-web",
      "packages/adapter-whatsapp",
      "packages/adapter-x",
      "packages/create-chat-sdk",
      "packages/state-ioredis",
      "packages/state-memory",
      {
        extends: "./packages/state-pg/vitest.config.ts",
        root: "./packages/state-pg",
        test: {
          name: "@chat-adapter/state-pg",
          exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
        },
      },
      "packages/state-redis",
      "packages/tests",
      "examples/nextjs-chat",
    ],
  },
});
