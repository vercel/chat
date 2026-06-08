import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./documentation-test-utils";

const CHAT_SKILL_PATHS = [
  "skills/chat/SKILL.md",
  "apps/docs/public/AGENTS.md",
  "apps/docs/public/.well-known/agent-skills/chat-sdk/SKILL.md",
] as const;

const ROOT_AGENT_GUIDANCE_PATH = "AGENTS.md";

describe("Chat SDK agent skill", () => {
  for (const skillPath of CHAT_SKILL_PATHS) {
    it(`${skillPath} documents the chat/adapters catalog subpath`, () => {
      const skill = readFileSync(join(REPO_ROOT, skillPath), "utf-8");

      expect(skill).toContain("chat/adapters");
      expect(skill).toContain("node_modules/chat/dist/adapters/index.d.ts");
      expect(skill).toContain("getSecretEnvVars");
    });
  }
});

describe("Root agent guidance", () => {
  it("documents the chat/adapters catalog maintenance requirements", () => {
    const guidance = readFileSync(
      join(REPO_ROOT, ROOT_AGENT_GUIDANCE_PATH),
      "utf-8"
    );

    expect(guidance).toContain("chat/adapters");
    expect(guidance).toContain("packages/chat/src/adapters/index.ts");
    expect(guidance).toContain("apps/docs/adapters.json");
  });
});
