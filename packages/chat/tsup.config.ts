import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/jsx-runtime.ts",
    "src/ai/index.ts",
    "src/adapters/index.ts",
    // Keep Workflow serializer classes in a shared chunk that does not load
    // the Node-only Chat runtime entrypoint.
    "src/serialization.ts",
    "src/workflow/index.ts",
  ],
  format: ["esm"],
  splitting: true,
  dts: true,
  clean: true,
  sourcemap: false,
});
