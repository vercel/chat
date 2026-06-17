import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { determineAgent, KNOWN_AGENTS, pathExists } from "./agent.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-detect-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("determineAgent", () => {
  it("uses AI_AGENT when provided", async () => {
    await expect(
      determineAgent({ AI_AGENT: " cursor " }, async () => false)
    ).resolves.toEqual({
      agent: { name: KNOWN_AGENTS.CURSOR },
      isAgent: true,
    });
  });

  it.each(
    Object.values(KNOWN_AGENTS).map((name) => [
      name,
      name === KNOWN_AGENTS.GITHUB_COPILOT_CLI
        ? KNOWN_AGENTS.GITHUB_COPILOT
        : name,
    ])
  )("detects AI_AGENT=%s", async (name, expected) => {
    await expect(
      determineAgent({ AI_AGENT: name }, async () => false)
    ).resolves.toEqual({
      agent: { name: expected },
      isAgent: true,
    });
  });

  it("normalizes GitHub Copilot CLI to GitHub Copilot", async () => {
    await expect(
      determineAgent(
        { AI_AGENT: KNOWN_AGENTS.GITHUB_COPILOT_CLI },
        async () => false
      )
    ).resolves.toEqual({
      agent: { name: KNOWN_AGENTS.GITHUB_COPILOT },
      isAgent: true,
    });
  });

  it("ignores empty AI_AGENT values", async () => {
    await expect(
      determineAgent({ AI_AGENT: " " }, async () => false)
    ).resolves.toEqual({
      agent: undefined,
      isAgent: false,
    });
  });

  it.each([
    ["Cursor", { CURSOR_TRACE_ID: "trace" }, KNOWN_AGENTS.CURSOR],
    ["Cursor CLI", { CURSOR_AGENT: "1" }, KNOWN_AGENTS.CURSOR_CLI],
    [
      "Cursor CLI extension host",
      { CURSOR_EXTENSION_HOST_ROLE: "agent-exec" },
      KNOWN_AGENTS.CURSOR_CLI,
    ],
    ["Gemini", { GEMINI_CLI: "1" }, KNOWN_AGENTS.GEMINI],
    ["Codex sandbox", { CODEX_SANDBOX: "1" }, KNOWN_AGENTS.CODEX],
    ["Codex CI", { CODEX_CI: "1" }, KNOWN_AGENTS.CODEX],
    ["Codex thread", { CODEX_THREAD_ID: "thread" }, KNOWN_AGENTS.CODEX],
    ["Antigravity", { ANTIGRAVITY_AGENT: "1" }, KNOWN_AGENTS.ANTIGRAVITY],
    ["Augment", { AUGMENT_AGENT: "1" }, KNOWN_AGENTS.AUGMENT_CLI],
    ["OpenCode", { OPENCODE_CLIENT: "1" }, KNOWN_AGENTS.OPENCODE],
    ["Replit", { REPL_ID: "repl" }, KNOWN_AGENTS.REPLIT],
    ["Copilot model", { COPILOT_MODEL: "gpt" }, KNOWN_AGENTS.GITHUB_COPILOT],
    [
      "Copilot allow all",
      { COPILOT_ALLOW_ALL: "1" },
      KNOWN_AGENTS.GITHUB_COPILOT,
    ],
    [
      "Copilot token",
      { COPILOT_GITHUB_TOKEN: "token" },
      KNOWN_AGENTS.GITHUB_COPILOT,
    ],
  ])("detects %s", async (_label, env, expected) => {
    await expect(determineAgent(env, async () => false)).resolves.toEqual({
      agent: { name: expected },
      isAgent: true,
    });
  });

  it("detects Claude and Cowork", async () => {
    await expect(
      determineAgent({ CLAUDE_CODE: "1" }, async () => false)
    ).resolves.toEqual({
      agent: { name: KNOWN_AGENTS.CLAUDE },
      isAgent: true,
    });
    await expect(
      determineAgent(
        { CLAUDECODE: "1", CLAUDE_CODE_IS_COWORK: "1" },
        async () => false
      )
    ).resolves.toEqual({
      agent: { name: KNOWN_AGENTS.COWORK },
      isAgent: true,
    });
  });

  it("detects Devin from the local sentinel path", async () => {
    await expect(determineAgent({}, async () => true)).resolves.toEqual({
      agent: { name: KNOWN_AGENTS.DEVIN },
      isAgent: true,
    });
  });

  it("returns false when no detector matches", async () => {
    await expect(
      determineAgent(
        { CURSOR_EXTENSION_HOST_ROLE: "worker" },
        async () => false
      )
    ).resolves.toEqual({
      agent: undefined,
      isAgent: false,
    });
  });
});

describe("pathExists", () => {
  it("checks whether a path exists", async () => {
    const existing = path.join(tmpDir, "exists");
    fs.writeFileSync(existing, "");

    await expect(pathExists(existing)).resolves.toBe(true);
    await expect(pathExists(path.join(tmpDir, "missing"))).resolves.toBe(false);
  });
});
