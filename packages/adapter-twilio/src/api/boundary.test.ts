import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_DIR, walkImportGraph } from "../test-utils";

const API_ENTRY = join(SRC_DIR, "api", "index.ts");

describe("api import boundary", () => {
  it("does not reach the Chat SDK, the shared package, the full adapter, or the twilio package", async () => {
    const graph = await walkImportGraph(API_ENTRY, SRC_DIR);

    expect(graph.bare).toEqual({});
    expect(graph.files).toEqual(["api/index.ts"]);
    expect(graph.files).not.toContain("index.ts");
    expect(graph.files).not.toContain("cards.ts");
  });
});
