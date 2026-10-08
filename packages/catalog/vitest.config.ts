import { defineProject } from "vitest/config";

export default defineProject({
  // The factory-export test imports official adapter sources. Resolve their
  // workspace dependencies from source so it does not depend on build order;
  // `chat` cannot be a dev dependency here because it depends on this package.
  resolve: {
    alias: [
      {
        find: /^chat$/,
        replacement: new URL("../chat/src/index.ts", import.meta.url).pathname,
      },
      {
        find: /^@chat-adapter\/shared$/,
        replacement: new URL("../adapter-shared/src/index.ts", import.meta.url)
          .pathname,
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // Check public type contracts that tsc skips because tests are excluded.
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
      tsconfig: "./tsconfig.typecheck.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test-d.ts"],
    },
  },
});
