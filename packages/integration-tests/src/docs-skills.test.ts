import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./documentation-test-utils";

describe("Chat SDK agent skill", () => {
  const skill = readFileSync(join(REPO_ROOT, "skills/chat/SKILL.md"), "utf-8");

  it("documents the chat/adapters catalog subpath", () => {
    expect(skill).toContain("chat/adapters");
    expect(skill).toContain("getSecretEnvVars");
    expect(skill).toContain("chat-sdk.dev/llms.txt");
  });

  it("points agents at create-chat-sdk help", () => {
    expect(skill).toContain("npx create-chat-sdk --help");
    expect(skill).toContain("license: MIT");
  });
});
