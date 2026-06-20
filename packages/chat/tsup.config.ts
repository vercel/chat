import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/jsx-runtime.ts",
    "src/ai/index.ts",
    "src/adapters/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
});
