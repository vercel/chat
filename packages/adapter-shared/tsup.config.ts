import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    mentions: "src/mentions.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "es2022",
});
