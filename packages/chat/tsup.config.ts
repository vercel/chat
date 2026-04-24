import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/test.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ["vitest"],
});
