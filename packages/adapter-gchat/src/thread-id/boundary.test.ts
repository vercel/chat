import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("thread-id import boundary", () => {
  it("does not import the full adapter or runtime packages", async () => {
    const directory = new URL(".", import.meta.url);
    const files = await readdir(directory);
    const source = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
          .map((file) => readFile(new URL(file, directory), "utf8"))
      )
    ).join("\n");

    expect(source).not.toContain('from "chat"');
    expect(source).not.toContain('from "@chat-adapter/shared"');
    expect(source).not.toContain('from "@googleapis/chat"');
    expect(source).not.toContain('from "@googleapis/workspaceevents"');
    expect(source).not.toContain('from "../index"');
  });
});
