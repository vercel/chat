import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "../types.js";

const CANCEL = Symbol("cancel");
const spinnerInstance = { start: vi.fn(), stop: vi.fn() };

vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn((value: unknown) => value === CANCEL),
  log: { warning: vi.fn() },
  spinner: vi.fn(() => spinnerInstance),
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue(undefined),
}));

import { log, spinner } from "@clack/prompts";
import { execa } from "execa";
import { scaffold } from "./run.js";

const makeConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  description: "",
  name: "test-project",
  packageManager: "npm",
  platformAdapters: [],
  shouldInstall: false,
  shouldInitializeGit: true,
  stateAdapter: {
    description: "Memory",
    env: {},
    factoryExport: "createMemoryState",
    group: "official",
    name: "Memory",
    packageName: "@chat-adapter/state-memory",
    peerDeps: [],
    slug: "memory",
    type: "state",
  },
  ...overrides,
});

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-chat-sdk-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scaffold", () => {
  it("writes generated project files", async () => {
    await expect(
      scaffold(makeConfig(), { force: false, quiet: true, yes: true })
    ).resolves.toBe(true);
    const projectDir = path.join(tmpDir, "test-project");
    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src/lib/bot.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "next-env.d.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".chat-sdk.json"))).toBe(true);
    const route = fs.readFileSync(
      path.join(projectDir, "src/app/api/webhooks/[platform]/route.ts"),
      "utf-8"
    );
    expect(route).toContain("interface Context");
    expect(route).toContain("params: Promise<{ platform: string }>");
    expect(route).not.toContain("RouteContext");
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf-8")
    );
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(projectDir, "tsconfig.json"), "utf-8")
    );
    expect(tsconfig.include).toContain(".next/dev/types/**/*.ts");
  });

  it("renames the template gitignore to .gitignore", async () => {
    await scaffold(makeConfig(), { force: false, quiet: true, yes: true });
    const projectDir = path.join(tmpDir, "test-project");
    expect(fs.existsSync(path.join(projectDir, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "gitignore"))).toBe(false);
    expect(
      fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8")
    ).toContain("node_modules");
  });

  it("initializes git by default", async () => {
    await scaffold(makeConfig(), { force: false, quiet: false, yes: true });

    expect(execa).toHaveBeenCalledWith(
      "git",
      ["init"],
      expect.objectContaining({ stdio: "pipe" })
    );
    expect(spinnerInstance.stop).toHaveBeenCalledWith(
      "Git repository initialized."
    );
  });

  it("skips git initialization when disabled", async () => {
    await scaffold(makeConfig({ shouldInitializeGit: false }), {
      force: false,
      quiet: true,
      yes: true,
    });

    expect(execa).not.toHaveBeenCalled();
  });

  it("warns when git initialization fails", async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error("git failed"));

    await expect(
      scaffold(makeConfig(), { force: false, quiet: false, yes: true })
    ).resolves.toBe(true);
    expect(spinnerInstance.stop).toHaveBeenCalledWith(
      "Failed to initialize git repository."
    );
    expect(log.warning).toHaveBeenCalledWith(
      'Run "git init" manually in the project directory.'
    );
  });

  it("rejects non-empty directories unless forced", async () => {
    const projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "existing.txt"), "old");

    await expect(
      scaffold(makeConfig(), { force: false, quiet: true, yes: true })
    ).rejects.toThrow("Re-run with --force");
  });

  it("overwrites generated files when forced", async () => {
    const projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "README.md"), "old readme");
    fs.writeFileSync(path.join(projectDir, "existing.txt"), "old");

    await expect(
      scaffold(makeConfig(), { force: true, quiet: true, yes: true })
    ).resolves.toBe(true);

    expect(
      fs.readFileSync(path.join(projectDir, "README.md"), "utf-8")
    ).not.toBe("old readme");
    expect(
      fs.readFileSync(path.join(projectDir, "existing.txt"), "utf-8")
    ).toBe("old");
  });

  it("preserves unowned conditional files when forced", async () => {
    const projectDir = path.join(tmpDir, "test-project");
    const route = path.join(projectDir, "src/app/api/chat/route.ts");
    const gateway = path.join(
      projectDir,
      "src/app/api/discord/gateway/route.ts"
    );
    fs.mkdirSync(path.dirname(route), { recursive: true });
    fs.mkdirSync(path.dirname(gateway), { recursive: true });
    fs.writeFileSync(route, "custom route");
    fs.writeFileSync(gateway, "custom gateway");
    fs.writeFileSync(path.join(projectDir, "vercel.json"), '{"custom":true}\n');

    await scaffold(makeConfig(), {
      force: true,
      quiet: true,
      yes: true,
    });

    expect(fs.readFileSync(route, "utf-8")).toBe("custom route");
    expect(fs.readFileSync(gateway, "utf-8")).toBe("custom gateway");
    expect(fs.readFileSync(path.join(projectDir, "vercel.json"), "utf-8")).toBe(
      '{"custom":true}\n'
    );
  });

  it("ignores missing files recorded by generated state", async () => {
    const projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".chat-sdk.json"),
      '{"files":["vercel.json"],"version":1}\n'
    );

    await expect(
      scaffold(makeConfig(), { force: true, quiet: true, yes: true })
    ).resolves.toBe(true);
  });

  it("writes conditional web route files", async () => {
    await scaffold(
      makeConfig({
        platformAdapters: [
          {
            description: "Web",
            env: {},
            factoryExport: "createWebAdapter",
            group: "official",
            name: "Web",
            packageName: "@chat-adapter/web",
            peerDeps: [],
            slug: "web",
            type: "platform",
          },
        ],
      }),
      { force: false, quiet: true, yes: true }
    );
    const projectDir = path.join(tmpDir, "test-project");
    expect(
      fs.existsSync(path.join(projectDir, "src/app/api/chat/route.ts"))
    ).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src/lib/auth-stub.ts"))).toBe(
      true
    );
  });

  it("writes the Discord Gateway route and vercel.json crons", async () => {
    await scaffold(
      makeConfig({
        platformAdapters: [
          {
            description: "Discord",
            env: {},
            factoryExport: "createDiscordAdapter",
            group: "official",
            name: "Discord",
            packageName: "@chat-adapter/discord",
            peerDeps: [],
            slug: "discord",
            type: "platform",
          },
        ],
      }),
      { force: false, quiet: true, yes: true }
    );
    const projectDir = path.join(tmpDir, "test-project");
    expect(
      fs.existsSync(
        path.join(projectDir, "src/app/api/discord/gateway/route.ts")
      )
    ).toBe(true);
    const vercelJson = JSON.parse(
      fs.readFileSync(path.join(projectDir, "vercel.json"), "utf-8")
    );
    expect(vercelJson.crons).toEqual([
      { path: "/api/discord/gateway", schedule: "*/9 * * * *" },
    ]);
  });

  it("removes stale conditional files on a --force re-run", async () => {
    const webConfig = makeConfig({
      platformAdapters: [
        {
          description: "Web",
          env: {},
          factoryExport: "createWebAdapter",
          group: "official",
          name: "Web",
          packageName: "@chat-adapter/web",
          peerDeps: [],
          slug: "web",
          type: "platform",
        },
      ],
    });
    await scaffold(webConfig, { force: false, quiet: true, yes: true });
    const projectDir = path.join(tmpDir, "test-project");
    expect(
      fs.existsSync(path.join(projectDir, "src/app/api/chat/route.ts"))
    ).toBe(true);

    await scaffold(makeConfig({ platformAdapters: [] }), {
      force: true,
      quiet: true,
      yes: true,
    });
    expect(
      fs.existsSync(path.join(projectDir, "src/app/api/chat/route.ts"))
    ).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "src/lib/auth-stub.ts"))).toBe(
      false
    );
    expect(fs.existsSync(path.join(projectDir, "src/app/api/chat"))).toBe(
      false
    );
    expect(
      JSON.parse(
        fs.readFileSync(path.join(projectDir, ".chat-sdk.json"), "utf-8")
      ).files
    ).toEqual([]);
  });

  it("removes a stale vercel.json and Discord gateway on a --force re-run", async () => {
    const discordConfig = makeConfig({
      platformAdapters: [
        {
          description: "Discord",
          env: {},
          factoryExport: "createDiscordAdapter",
          group: "official",
          name: "Discord",
          packageName: "@chat-adapter/discord",
          peerDeps: [],
          slug: "discord",
          type: "platform",
        },
      ],
    });
    await scaffold(discordConfig, { force: false, quiet: true, yes: true });
    const projectDir = path.join(tmpDir, "test-project");
    expect(fs.existsSync(path.join(projectDir, "vercel.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectDir, "src/app/api/discord/gateway/route.ts")
      )
    ).toBe(true);

    await scaffold(makeConfig({ platformAdapters: [] }), {
      force: true,
      quiet: true,
      yes: true,
    });
    expect(fs.existsSync(path.join(projectDir, "vercel.json"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "src/app/api/discord"))).toBe(
      false
    );
  });

  it("installs dependencies and handles install failures", async () => {
    await scaffold(makeConfig({ shouldInstall: true }), {
      force: false,
      quiet: false,
      yes: true,
    });
    expect(execa).toHaveBeenCalledWith(
      "npm",
      ["install"],
      expect.objectContaining({ stdio: "pipe" })
    );

    vi.mocked(execa)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("install failed"));
    await scaffold(makeConfig({ name: "install-fails", shouldInstall: true }), {
      force: false,
      quiet: false,
      yes: true,
    });
    expect(log.warning).toHaveBeenCalledWith(
      'Run "npm install" manually in the project directory.'
    );
  });

  it("exits non-zero when install fails in non-interactive mode", async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error("install failed"));
    await scaffold(
      makeConfig({
        name: "ni-install-fails",
        shouldInstall: true,
        shouldInitializeGit: false,
      }),
      { force: false, quiet: true, yes: true }
    );
    expect(process.exitCode).toBe(1);
  });

  it("stays successful when install fails in interactive mode", async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error("install failed"));
    await scaffold(
      makeConfig({
        name: "i-install-fails",
        shouldInstall: true,
        shouldInitializeGit: false,
      }),
      { force: false, quiet: false, yes: false }
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("installs dependencies in quiet mode", async () => {
    await scaffold(makeConfig({ shouldInstall: true }), {
      force: false,
      quiet: true,
      yes: true,
    });
    expect(execa).toHaveBeenCalledWith(
      "npm",
      ["install"],
      expect.objectContaining({ stdio: "pipe" })
    );
  });

  it("stops the creation spinner when file generation fails", async () => {
    cwdSpy.mockReturnValue("/dev/null");
    await expect(
      scaffold(makeConfig(), { force: false, quiet: false, yes: true })
    ).rejects.toThrow();
    expect(spinner).toHaveBeenCalled();
    expect(spinnerInstance.stop).toHaveBeenCalledWith(
      "Failed to create project files."
    );
  });
});
