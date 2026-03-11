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
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/mock-adapter.ts"],
    },
  },
});
