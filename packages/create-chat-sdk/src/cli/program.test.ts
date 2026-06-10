import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agent.js", () => ({
  determineAgent: vi.fn().mockResolvedValue({
    agent: undefined,
    isAgent: false,
  }),
}));

vi.mock("./run.js", () => ({
  runCli: vi.fn().mockResolvedValue(undefined),
}));

import { determineAgent } from "./agent.js";
import { buildAdapterList, createProgram } from "./program.js";
import { runCli } from "./run.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(determineAgent).mockResolvedValue({
    agent: undefined,
    isAgent: false,
  });
});

describe("buildAdapterList", () => {
  it("lists platform groups and state adapters", () => {
    const result = buildAdapterList();
    expect(result).toContain("Official:");
    expect(result).toContain("Vendor-official:");
    expect(result).toContain("State:");
    expect(result).toContain("slack");
    expect(result).toContain("memory");
  });
});

describe("createProgram", () => {
  it("creates the CLI program", () => {
    expect(createProgram().name()).toBe("create-chat-sdk");
  });

  it("prints adapter help", () => {
    const program = createProgram();
    let output = "";
    program.configureOutput({ writeOut: (value) => (output += value) });
    program.outputHelp();
    expect(output).toContain("Available adapters:");
    expect(output).toContain("Examples:");
  });

  it("passes parsed options to runCli", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "create-chat-sdk",
      "my-bot",
      "-d",
      "desc",
      "--adapter",
      "slack",
      "redis",
      "--pm",
      "pnpm",
      "-yq",
      "--skip-install",
    ]);

    expect(runCli).toHaveBeenCalledWith({
      description: "desc",
      force: false,
      initializeGit: true,
      install: false,
      name: "my-bot",
      packageManager: "pnpm",
      quiet: true,
      selectedAdapters: ["slack", "redis"],
      yes: true,
    });
  });

  it("supports the short skip-install option", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "-s"]);

    expect(runCli).toHaveBeenCalledWith({
      description: undefined,
      force: false,
      initializeGit: true,
      install: false,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: false,
    });
  });

  it("disables git initialization when requested", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "--no-git"]);

    expect(runCli).toHaveBeenCalledWith({
      description: undefined,
      force: false,
      initializeGit: false,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: false,
    });
  });

  it("passes force when requested", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "-f"]);

    expect(runCli).toHaveBeenCalledWith({
      description: undefined,
      force: true,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: false,
    });
  });

  it("uses non-interactive mode when an agent is detected", async () => {
    vi.mocked(determineAgent).mockResolvedValueOnce({
      agent: { name: "cursor" },
      isAgent: true,
    });
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot"]);

    expect(runCli).toHaveBeenCalledWith({
      description: undefined,
      force: false,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: true,
    });
  });

  it("keeps explicit yes behavior outside agents", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "--yes"]);

    expect(runCli).toHaveBeenCalledWith({
      description: undefined,
      force: false,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: true,
    });
  });

  it("passes default option values to runCli", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot"]);

    expect(runCli).toHaveBeenCalledWith({
      description: undefined,
      force: false,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      yes: false,
    });
  });

  it("rejects invalid package managers", async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });

    await expect(
      program.parseAsync(["node", "create-chat-sdk", "--pm", "badpm"])
    ).rejects.toThrow("expected npm, yarn, pnpm, or bun");
  });
});
