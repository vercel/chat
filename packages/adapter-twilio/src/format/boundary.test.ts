import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_DIR, walkImportGraph } from "../test-utils";

const FORMAT_ENTRY = join(SRC_DIR, "format", "index.ts");

describe("format import boundary", () => {
  it("does not reach the Chat SDK, the shared package, the full adapter, or Node builtins", async () => {
    const graph = await walkImportGraph(FORMAT_ENTRY, SRC_DIR);

    expect(graph.bare).toEqual({});
    expect(graph.files).toEqual(["format/index.ts"]);
    expect(graph.files).not.toContain("index.ts");
    expect(graph.files).not.toContain("cards.ts");
    for (const file of graph.files) {
      const source = await readFile(join(SRC_DIR, file), "utf8");
      expect(source).not.toContain("node:");
    }
  });
});
