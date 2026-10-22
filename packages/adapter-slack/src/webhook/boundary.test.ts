import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("webhook import boundary", () => {
  it("does not import the full adapter or runtime packages", async () => {
    const files = [
      "index.ts",
      "parse.ts",
      "types.ts",
      "utils.ts",
      "verify.ts",
      // Shared with the adapter and re-exported from this subpath.
      "../event.ts",
      "../mention.ts",
    ];
    const source = (
      await Promise.all(
        files.map((file) =>
          readFile(new URL(`./${file}`, import.meta.url), {
            encoding: "utf8",
          })
        )
      )
    ).join("\n");

    // The runtime-free mentions subpath is the only allowed shared import.
    const sharedImports = source.match(
      /from ["']@chat-adapter\/shared[^"']*["']/g
    );
    expect(sharedImports).toStrictEqual([
      'from "@chat-adapter/shared/mentions"',
    ]);
    expect(source).not.toContain('from "chat"');
    expect(source).not.toContain("from '@chat-adapter/shared'");
    expect(source).not.toContain('from "@chat-adapter/shared"');
    expect(source).not.toContain('from "@slack/web-api"');
    expect(source).not.toContain('from "@slack/socket-mode"');
    expect(source).not.toContain('from "../index"');
    expect(source).not.toContain("node:crypto");
  });
});
