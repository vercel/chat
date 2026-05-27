import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("voice import boundary", () => {
  it("does not import the full adapter or runtime packages", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), {
      encoding: "utf8",
    });

    expect(source).not.toContain('from "chat"');
    expect(source).not.toContain("from '@chat-adapter/shared'");
    expect(source).not.toContain('from "@chat-adapter/shared"');
    expect(source).not.toContain('from "../index"');
    expect(source).not.toContain('from "twilio"');
    expect(source).not.toContain("node:");
  });
});
