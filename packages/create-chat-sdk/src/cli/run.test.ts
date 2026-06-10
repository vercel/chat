import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "../types.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("../prompts/flow.js", () => ({
  runPrompts: vi.fn(),
}));

vi.mock("../scaffold/run.js", () => ({
  scaffold: vi.fn(),
}));

import { intro, note, outro } from "@clack/prompts";
import { runPrompts } from "../prompts/flow.js";
import { scaffold } from "../scaffold/run.js";
import { runCli } from "./run.js";

const config: ProjectConfig = {
  description: "",
  name: "my-bot",
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
};

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

describe("runCli", () => {
  it("runs prompts and scaffold", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockResolvedValueOnce(true);

    await runCli({
      force: false,
      initializeGit: true,
      quiet: false,
      yes: true,
    });

    expect(intro).toHaveBeenCalled();
    expect(runPrompts).toHaveBeenCalledWith({
      description: undefined,
      initializeGit: true,
      install: undefined,
      name: undefined,
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: true,
    });
    expect(scaffold).toHaveBeenCalledWith(config, {
      force: false,
      quiet: false,
      yes: true,
    });
    expect(note).toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith(expect.stringContaining("Done!"));
    expect(outro).toHaveBeenCalledWith(
      expect.stringContaining("Use the Chat SDK skill for agent guidance.")
    );
  });

  it("handles prompt cancellation", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(null);

    await runCli({
      force: false,
      initializeGit: true,
      quiet: false,
      yes: false,
    });

    expect(outro).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
    expect(process.exitCode).toBe(0);
    expect(scaffold).not.toHaveBeenCalled();
  });

  it("handles prompt cancellation in quiet mode", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(null);

    await runCli({
      force: false,
      initializeGit: true,
      quiet: true,
      yes: false,
    });

    expect(outro).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("handles scaffold cancellation", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockResolvedValueOnce(false);

    await runCli({
      force: false,
      initializeGit: true,
      quiet: false,
      yes: false,
    });

    expect(outro).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
    expect(process.exitCode).toBe(0);
  });

  it("handles scaffold cancellation in quiet mode", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockResolvedValueOnce(false);

    await runCli({
      force: false,
      initializeGit: true,
      quiet: true,
      yes: false,
    });

    expect(outro).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("sets exitCode on errors", async () => {
    vi.mocked(runPrompts).mockRejectedValueOnce(new Error("bad"));

    await runCli({
      force: false,
      initializeGit: true,
      quiet: false,
      yes: false,
    });

    expect(outro).toHaveBeenCalledWith(expect.stringContaining("bad"));
    expect(process.exitCode).toBe(1);
  });

  it("handles non-Error exceptions", async () => {
    vi.mocked(runPrompts).mockRejectedValueOnce("bad");

    await runCli({
      force: false,
      initializeGit: true,
      quiet: false,
      yes: false,
    });

    expect(outro).toHaveBeenCalledWith(expect.stringContaining("bad"));
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode on errors in quiet mode", async () => {
    vi.mocked(runPrompts).mockRejectedValueOnce(new Error("bad"));

    await runCli({
      force: false,
      initializeGit: true,
      quiet: true,
      yes: false,
    });

    expect(outro).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("suppresses output in quiet mode", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockResolvedValueOnce(true);

    await runCli({ force: false, initializeGit: true, quiet: true, yes: true });

    expect(intro).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(outro).not.toHaveBeenCalled();
  });
});
