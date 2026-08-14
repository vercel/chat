import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/chat/index.ts", "src/setup.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
