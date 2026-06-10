import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const distEntry = path.join(packageRoot, "dist/index.js");

let tmpDir: string;

const readProjectFile = (projectName: string, filePath: string): string =>
  fs.readFileSync(path.join(tmpDir, projectName, filePath), "utf-8");

beforeAll(async () => {
  await execa("pnpm", ["build"], {
    cwd: packageRoot,
    stdio: "pipe",
  });
}, 120_000);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-chat-sdk-package-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("built CLI package", () => {
  it("scaffolds a project from the built dist entry", async () => {
    await execa(
      "node",
      [
        distEntry,
        "smoke-bot",
        "--adapter",
        "slack",
        "redis",
        "-yq",
        "--skip-install",
        "--no-git",
      ],
      {
        cwd: tmpDir,
        stdio: "pipe",
      }
    );

    const botTs = readProjectFile("smoke-bot", "src/lib/bot.ts");
    const packageJson = JSON.parse(
      readProjectFile("smoke-bot", "package.json")
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(botTs).toContain("createSlackAdapter");
    expect(botTs).toContain("createRedisState");
    expect(packageJson.dependencies?.["@chat-adapter/slack"]).toBe("latest");
    expect(packageJson.dependencies?.["@chat-adapter/state-redis"]).toBe(
      "latest"
    );
    expect(
      fs.existsSync(
        path.join(tmpDir, "smoke-bot", ".agents/skills/chat-sdk/SKILL.md")
      )
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "smoke-bot", ".git"))).toBe(false);
  });

  it("includes runtime, template, docs, and README files in the package", async () => {
    const { stdout } = await execa("pnpm", ["pack", "--dry-run", "--json"], {
      cwd: packageRoot,
      stdio: "pipe",
    });
    const packed = JSON.parse(stdout) as {
      files: Array<{ path: string }>;
    };
    const files = new Set(packed.files.map((file) => file.path));

    expect(files).toContain("dist/index.js");
    expect(files).toContain("docs/create-chat-sdk.mdx");
    expect(files).toContain("README.md");
    expect(files).toContain("_template/AGENTS.md");
    expect(files).toContain("_template/CLAUDE.md");
    expect(files).toContain("_template/.agents/skills/chat-sdk/SKILL.md");
    expect(files).toContain("_template/.claude/skills/chat-sdk/SKILL.md");
  });
});
