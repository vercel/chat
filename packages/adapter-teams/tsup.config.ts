import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    api: "src/api/index.ts",
    cards: "src/cards-primitives/index.ts",
    format: "src/format/index.ts",
    graph: "src/graph/index.ts",
    index: "src/index.ts",
    modals: "src/modals-primitives/index.ts",
    webhook: "src/webhook/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ["botbuilder"],
  noExternal: ["@microsoft/microsoft-graph-client"],
});
