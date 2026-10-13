import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/claude/index.ts",
    "src/cursor/index.ts",
    "src/openai/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ["@anthropic-ai/sdk", "@cursor/sdk", "openai"],
});
