import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    api: "src/api/index.ts",
    cards: "src/cards-primitives/index.ts",
    format: "src/format/index.ts",
    index: "src/index.ts",
    "thread-id": "src/thread-id/index.ts",
    webhook: "src/webhook/index.ts",
    "workspace-events": "src/workspace-events.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ["googleapis"],
});
