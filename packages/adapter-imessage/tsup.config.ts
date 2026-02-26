import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@photon-ai/advanced-imessage-kit", "@photon-ai/imessage-kit"],
});
