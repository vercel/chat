import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      // Map JSX runtime imports to our custom runtime
      "react/jsx-runtime": resolve(import.meta.dirname, "src/jsx-runtime.ts"),
      "react/jsx-dev-runtime": resolve(
        import.meta.dirname,
        "src/jsx-runtime.ts"
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // The TanStack tests carry compile-time compatibility assertions against
    // `@tanstack/ai` types; tsconfig.json excludes tests, so check them here.
    typecheck: {
      enabled: true,
      include: ["src/ai/tanstack/*.test.ts"],
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/mock-adapter.ts"],
    },
  },
});
