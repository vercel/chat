import { resolve } from "node:path";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      chat: resolve(import.meta.dirname, "../chat/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["@chat-adapter/tests/setup"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
