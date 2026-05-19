import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("webhook import boundary", () => {
  it("does not import the full adapter or runtime packages", async () => {
    const files = [
      "webhook.ts",
      "webhook-parse.ts",
      "webhook-types.ts",
      "webhook-utils.ts",
      "webhook-verify.ts",
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

    expect(source).not.toContain('from "chat"');
    expect(source).not.toContain("from '@chat-adapter/shared'");
    expect(source).not.toContain('from "@chat-adapter/shared"');
    expect(source).not.toContain('from "@slack/web-api"');
    expect(source).not.toContain('from "@slack/socket-mode"');
    expect(source).not.toContain('from "./index"');
    expect(source).not.toContain("node:crypto");
  });
});
