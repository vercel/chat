import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    globals: true,
    environment: "node",
    // tsc skips test files, so type-check them here. This keeps fixtures in
    // step with the provider SDK types and runs the *.test-d.ts assertions.
    typecheck: {
      enabled: true,
      include: ["src/**/*.test.ts", "src/**/*.test-d.ts"],
      tsconfig: "./tsconfig.typecheck.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test-d.ts", "src/test-utils.ts"],
    },
  },
});
