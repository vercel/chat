import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("webhook import boundary", () => {
  it("does not import the full adapter or runtime packages", async () => {
    const files = ["index.ts", "parse.ts", "types.ts", "verify.ts"];
    for (const file of files) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), {
        encoding: "utf8",
      });

      expect(source).not.toContain('from "chat"');
      expect(source).not.toContain("from '@chat-adapter/shared'");
      expect(source).not.toContain('from "@chat-adapter/shared"');
      expect(source).not.toContain('from "../index"');
      expect(source).not.toContain('from "twilio"');
    }
  });
});
