import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    api: "src/api/index.ts",
    blocks: "src/blocks/index.ts",
    format: "src/format/index.ts",
    index: "src/index.ts",
    webhook: "src/webhook/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ["@slack/web-api", "@slack/socket-mode"],
});
