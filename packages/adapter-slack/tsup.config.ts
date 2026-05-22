import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
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
