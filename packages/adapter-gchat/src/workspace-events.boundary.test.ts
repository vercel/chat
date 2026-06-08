import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("workspace-events import boundary", () => {
  it("does not import the full adapter or Chat SDK runtime packages", async () => {
    const source = await readFile(
      new URL("./workspace-events.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toContain('from "chat"');
    expect(source).not.toContain('from "@chat-adapter/shared"');
    expect(source).not.toContain('from "./index"');
  });
});
