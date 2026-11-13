import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SRC_DIR, walkImportGraph } from "../test-utils";

const WEBHOOK_ENTRY = join(SRC_DIR, "webhook", "index.ts");
const LIGHT_CALLBACK_SUBPATH = "@chat-adapter/shared/callback-data";

describe("webhook import boundary", () => {
  it("reaches only the light shared callback subpath from the webhook entry sources", async () => {
    const graph = await walkImportGraph(WEBHOOK_ENTRY, SRC_DIR);

    expect(graph.bare).toEqual({ [LIGHT_CALLBACK_SUBPATH]: ["callback.ts"] });
    expect(graph.files).toEqual(
      expect.arrayContaining([
        "callback.ts",
        "webhook/index.ts",
        "webhook/parse.ts",
        "webhook/verify.ts",
      ])
    );
    expect(graph.files).not.toContain("index.ts");
    expect(graph.files).not.toContain("cards.ts");
  });

  it("resolves the shared callback subpath to built files with no package imports", async () => {
    const entry = fileURLToPath(import.meta.resolve(LIGHT_CALLBACK_SUBPATH));
    const graph = await walkImportGraph(entry, dirname(entry));

    expect(graph.files).toContain("callback-data.js");
    expect(graph.bare).toEqual({});
  });
});
