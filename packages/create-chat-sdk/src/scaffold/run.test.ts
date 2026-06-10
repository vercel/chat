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
