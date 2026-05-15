import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/matchers.ts", "src/setup.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
});
