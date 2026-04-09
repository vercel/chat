import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/testing.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ["vitest"],
});
