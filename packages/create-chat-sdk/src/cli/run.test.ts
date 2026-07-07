import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "../types.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  log: { info: vi.fn() },
  note: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("../prompts/flow.js", () => ({
  runPrompts: vi.fn(),
}));

vi.mock("../scaffold/run.js", () => ({
  scaffold: vi.fn(),
}));

import { intro, log, note, outro } from "@clack/prompts";
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
      connect: undefined,
      description: undefined,
      initializeGit: true,
      install: undefined,
      name: undefined,
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: undefined,
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

  it("prints Vercel Connect next steps when Connect is enabled", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce({
      ...config,
      useConnect: true,
    });
    vi.mocked(scaffold).mockResolvedValueOnce(true);

    await runCli({
      connect: true,
      force: false,
      initializeGit: true,
      quiet: false,
      yes: true,
    });

    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("vercel env pull"),
      "Next steps"
    );
  });

  it("announces detected coding agents", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockResolvedValueOnce(true);

    await runCli({
      detectedAgent: "cursor",
      force: false,
      initializeGit: true,
      quiet: false,
      yes: true,
    });

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("Coding agent detected (cursor)")
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("--interactive")
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

  it("still reports errors to stderr in quiet mode", async () => {
    vi.mocked(runPrompts).mockRejectedValueOnce(new Error("bad"));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await runCli({
      force: false,
      initializeGit: true,
      quiet: true,
      yes: false,
    });

    expect(outro).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("bad");
    expect(process.exitCode).toBe(1);
    errorSpy.mockRestore();
  });

  it("suppresses output in quiet mode", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockResolvedValueOnce(true);

    await runCli({ force: false, initializeGit: true, quiet: true, yes: true });

    expect(intro).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(outro).not.toHaveBeenCalled();
  });

  it("does not print success after a non-interactive install failure", async () => {
    vi.mocked(runPrompts).mockResolvedValueOnce(config);
    vi.mocked(scaffold).mockImplementationOnce(async () => {
      process.exitCode = 1;
      return true;
    });

    await runCli({
      force: false,
      initializeGit: true,
      quiet: false,
      yes: true,
    });

    expect(note).not.toHaveBeenCalled();
    expect(outro).not.toHaveBeenCalledWith(expect.stringContaining("Done!"));
  });
});
