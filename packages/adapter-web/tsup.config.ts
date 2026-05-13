import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "src/react/index.ts",
    "vue/index": "src/vue/index.ts",
    "svelte/index": "src/svelte/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: [
    "ai",
    "@ai-sdk/react",
    "@ai-sdk/vue",
    "@ai-sdk/svelte",
    "react",
    "svelte",
    "vue",
    "chat",
  ],
});
