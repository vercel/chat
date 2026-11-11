import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const IMPORT_STATEMENT = /^\s*import\b/m;
const FROM_CLAUSE = /\bfrom\s+["']/;

describe("mentions import boundary", () => {
  it("imports nothing, so the @chat-adapter/shared/mentions subpath stays runtime-free", async () => {
    const source = await readFile(new URL("./mentions.ts", import.meta.url), {
      encoding: "utf8",
    });

    expect(source).not.toMatch(IMPORT_STATEMENT);
    expect(source).not.toMatch(FROM_CLAUSE);
  });
});
