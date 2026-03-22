import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["botbuilder", "@microsoft/teams.apps", "@microsoft/teams.api"],
  noExternal: ["@microsoft/microsoft-graph-client"],
});
