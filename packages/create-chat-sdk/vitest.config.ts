import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: [
      {
        find: "chat/adapters",
        replacement: new URL("../chat/src/adapters/index.ts", import.meta.url)
          .pathname,
      },
      {
        find: "chat",
        replacement: new URL("../chat/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/types.ts",
        "src/catalog/index.ts",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
