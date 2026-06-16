import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

const read = (filePath: string): string => fs.readFileSync(filePath, "utf-8");

describe("synced package assets", () => {
  it("keeps bundled CLI docs aligned with the docs site", () => {
    expect(read(path.join(packageRoot, "docs/create-chat-sdk.mdx"))).toBe(
      read(path.join(repoRoot, "apps/docs/content/docs/create-chat-sdk.mdx"))
    );
  });

  it("keeps the template Chat SDK skill aligned with the repo skill", () => {
    expect(
      read(path.join(packageRoot, "_template/.agents/skills/chat-sdk/SKILL.md"))
    ).toBe(read(path.join(repoRoot, "skills/chat/SKILL.md")));
  });

  it("keeps template agent skill mirrors aligned", () => {
    expect(
      read(path.join(packageRoot, "_template/.agents/skills/chat-sdk/SKILL.md"))
    ).toBe(
      read(path.join(packageRoot, "_template/.claude/skills/chat-sdk/SKILL.md"))
    );
  });

  it("keeps template Claude instructions delegated to AGENTS.md", () => {
    expect(read(path.join(packageRoot, "_template/CLAUDE.md"))).toBe(
      "@AGENTS.md\n"
    );
  });
});
