import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/callback-data.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "es2022",
});
