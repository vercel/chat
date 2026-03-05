import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
});
