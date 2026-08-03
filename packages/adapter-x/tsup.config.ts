import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/chat/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
