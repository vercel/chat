import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter, ProjectConfig, StateAdapter } from "./types.js";

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === CANCEL),
  log: { warning: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue(undefined),
}));

import { confirm, log, spinner } from "@clack/prompts";
import { execa } from "execa";
import { scaffold } from "./scaffold.js";

const slackAdapter: PlatformAdapter = {
  name: "Slack",
  value: "slack",
  package: "@chat-adapter/slack",
  factoryFn: "createSlackAdapter",
  typeName: "SlackAdapter",
  category: "Messaging Platforms",
  envVars: [
    {
      name: "SLACK_SIGNING_SECRET",
      description: "Slack app signing secret",
      required: true,
    },
    {
      name: "SLACK_BOT_TOKEN",
      description: "Slack bot OAuth token",
      required: false,
    },
  ],
  serverExternalPackages: [],
};

const discordAdapter: PlatformAdapter = {
  name: "Discord",
  value: "discord",
  package: "@chat-adapter/discord",
  factoryFn: "createDiscordAdapter",
  typeName: "DiscordAdapter",
  category: "Messaging Platforms",
  envVars: [
    {
      name: "DISCORD_BOT_TOKEN",
      description: "Discord bot token",
      required: true,
    },
  ],
  serverExternalPackages: ["discord.js", "@discordjs/ws"],
};

const memoryState: StateAdapter = {
  name: "In-Memory",
  value: "memory",
  package: "@chat-adapter/state-memory",
  factoryFn: "createMemoryState",
  hint: "development only",
  envVars: [],
};

const redisState: StateAdapter = {
  name: "Redis",
  value: "redis",
  package: "@chat-adapter/state-redis",
  factoryFn: "createRedisState",
  hint: "production",
  envVars: [
    { name: "REDIS_URL", description: "Redis connection URL", required: true },
  ],
};

let tmpDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-project",
    description: "",
    platformAdapters: [slackAdapter],
    stateAdapter: memoryState,
    shouldInstall: false,
    packageManager: "npm",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-chat-sdk-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
});

afterEach(() => {
  cwdSpy.mockRestore();
  exitSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function projectDir() {
  return path.join(tmpDir, "test-project");
}

describe("scaffold", () => {
  describe("file creation", () => {
    it("copies template files to project directory", async () => {
      await scaffold(makeConfig(), true, true);
      expect(fs.existsSync(path.join(projectDir(), "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir(), "tsconfig.json"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(projectDir(), "next.config.ts"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(projectDir(), ".env.example"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir(), ".gitignore"))).toBe(true);
    });

    it("includes the dependencies needed for a Next.js app", async () => {
      await scaffold(makeConfig(), true, true);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectDir(), "package.json"), "utf-8")
      ) as { dependencies: Record<string, string> };

      expect(pkg.dependencies.next).toBeDefined();
      expect(pkg.dependencies.react).toBeDefined();
      expect(pkg.dependencies["react-dom"]).toBeDefined();
    });

    it("generates bot.ts with adapter config", async () => {
      await scaffold(makeConfig(), true, true);
      const botFile = fs.readFileSync(
        path.join(projectDir(), "src", "lib", "bot.ts"),
        "utf-8"
      );
      expect(botFile).toContain("createSlackAdapter");
      expect(botFile).toContain("createMemoryState");
    });
  });

  describe("post-processing", () => {
    it("replaces bot name in .env.example", async () => {
      await scaffold(makeConfig({ name: "test-project" }), true, true);
      const env = fs.readFileSync(
        path.join(projectDir(), ".env.example"),
        "utf-8"
      );
      expect(env).toContain("BOT_USERNAME=test-project");
    });

    it("appends platform adapter env vars to .env.example", async () => {
      await scaffold(makeConfig(), true, true);
      const env = fs.readFileSync(
        path.join(projectDir(), ".env.example"),
        "utf-8"
      );
      expect(env).toContain("# Slack");
      expect(env).toContain("SLACK_SIGNING_SECRET=");
      expect(env).toContain("# Slack bot OAuth token (optional)");
      expect(env).toContain("SLACK_BOT_TOKEN=");
    });

    it("appends state adapter env vars when present", async () => {
      await scaffold(makeConfig({ stateAdapter: redisState }), true, true);
      const env = fs.readFileSync(
        path.join(projectDir(), ".env.example"),
        "utf-8"
      );
      expect(env).toContain("# Redis State");
      expect(env).toContain("REDIS_URL=");
    });

    it("skips state env section when state has no env vars", async () => {
      await scaffold(makeConfig({ stateAdapter: memoryState }), true, true);
      const env = fs.readFileSync(
        path.join(projectDir(), ".env.example"),
        "utf-8"
      );
      expect(env).not.toContain("# In-Memory State");
    });

    it("adds serverExternalPackages to next.config.ts", async () => {
      await scaffold(
        makeConfig({ platformAdapters: [discordAdapter] }),
        true,
        true
      );
      const nextConfig = fs.readFileSync(
        path.join(projectDir(), "next.config.ts"),
        "utf-8"
      );
      expect(nextConfig).toContain("serverExternalPackages");
      expect(nextConfig).toContain('"discord.js"');
      expect(nextConfig).toContain('"@discordjs/ws"');
    });

    it("leaves next.config.ts unchanged when no external packages", async () => {
      await scaffold(makeConfig(), true, true);
      const nextConfig = fs.readFileSync(
        path.join(projectDir(), "next.config.ts"),
        "utf-8"
      );
      expect(nextConfig).not.toContain("serverExternalPackages");
    });
  });

  describe("package.json population", () => {
    it("writes name and adapter deps", async () => {
      await scaffold(makeConfig(), true, true);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectDir(), "package.json"), "utf-8")
      ) as {
        dependencies: Record<string, string>;
        name: string;
      };

      expect(pkg.name).toBe("test-project");
      expect(pkg.dependencies["@chat-adapter/slack"]).toBe("latest");
      expect(pkg.dependencies["@chat-adapter/state-memory"]).toBe("latest");
    });

    it("includes description when provided", async () => {
      await scaffold(makeConfig({ description: "My bot" }), true, true);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectDir(), "package.json"), "utf-8")
      ) as { description: string };
      expect(pkg.description).toBe("My bot");
    });

    it("omits description when empty", async () => {
      await scaffold(makeConfig({ description: "" }), true, true);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectDir(), "package.json"), "utf-8")
      ) as { description?: string };
      expect(pkg.description).toBeUndefined();
    });

    it("does not require npm when install is skipped", async () => {
      await scaffold(makeConfig({ shouldInstall: false }), true, true);
      expect(execa).not.toHaveBeenCalled();
    });
  });

  describe("directory overwrite", () => {
    it("prompts when directory exists, is not empty, and --yes is false", async () => {
      const dir = projectDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "file.txt"), "existing");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await scaffold(makeConfig(), false, true);
      expect(confirm).toHaveBeenCalled();
    });

    it("exits when overwrite is declined", async () => {
      const dir = projectDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "file.txt"), "existing");
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await expect(scaffold(makeConfig(), false, true)).rejects.toThrow(
        "process.exit"
      );
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("exits when overwrite is cancelled", async () => {
      const dir = projectDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "file.txt"), "existing");
      vi.mocked(confirm).mockResolvedValueOnce(CANCEL as never);

      await expect(scaffold(makeConfig(), false, true)).rejects.toThrow(
        "process.exit"
      );
    });

    it("skips prompt when --yes", async () => {
      const dir = projectDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "file.txt"), "existing");

      await scaffold(makeConfig(), true, true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("skips prompt when directory does not exist", async () => {
      await scaffold(makeConfig(), false, true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("skips prompt when directory is empty", async () => {
      fs.mkdirSync(projectDir(), { recursive: true });
      await scaffold(makeConfig(), false, true);
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("spinners", () => {
    it("shows spinners when not quiet", async () => {
      await scaffold(makeConfig(), true, false);
      expect(spinner).toHaveBeenCalled();
    });

    it("hides spinners when quiet", async () => {
      await scaffold(makeConfig(), true, true);
      expect(spinner).not.toHaveBeenCalled();
    });
  });

  describe("dependency installation", () => {
    it("installs dependencies when shouldInstall is true", async () => {
      await scaffold(makeConfig({ shouldInstall: true }), true, true);
      expect(execa).toHaveBeenCalledWith(
        "npm",
        ["install"],
        expect.objectContaining({ cwd: projectDir(), stdio: "pipe" })
      );
    });

    it("uses configured package manager for install", async () => {
      await scaffold(
        makeConfig({ shouldInstall: true, packageManager: "pnpm" }),
        true,
        true
      );
      expect(execa).toHaveBeenCalledWith(
        "pnpm",
        ["install"],
        expect.anything()
      );
    });

    it("updates generated readme commands to the selected package manager", async () => {
      await scaffold(
        makeConfig({ shouldInstall: false, packageManager: "pnpm" }),
        true,
        true
      );
      const readme = fs.readFileSync(
        path.join(projectDir(), "README.md"),
        "utf-8"
      );
      expect(readme).toContain("pnpm run dev");
      expect(readme).not.toContain("`npm run dev`");
    });

    it("skips install when shouldInstall is false", async () => {
      await scaffold(makeConfig({ shouldInstall: false }), true, true);
      const calls = vi.mocked(execa).mock.calls;
      const installCalls = calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("install")
      );
      expect(installCalls).toHaveLength(0);
    });

    it("handles install failure gracefully", async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error("install failed"));

      await scaffold(makeConfig({ shouldInstall: true }), true, false);
      expect(log.warning).toHaveBeenCalledWith(
        'Run "npm install" manually in the project directory.'
      );
    });

    it("shows install spinner when not quiet", async () => {
      await scaffold(makeConfig({ shouldInstall: true }), true, false);
      expect(spinner).toHaveBeenCalledTimes(2);
    });
  });
});
