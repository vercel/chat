import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    api: "src/api/index.ts",
    format: "src/format/index.ts",
    index: "src/index.ts",
    voice: "src/voice/index.ts",
    webhook: "src/webhook/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
});
