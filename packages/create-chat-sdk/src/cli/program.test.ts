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

  it("omits CLI-incompatible state adapters", () => {
    expect(buildAdapterList()).not.toContain("cloudflare-agents");
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
      connect: false,
      description: "desc",
      detectedAgent: undefined,
      force: false,
      initializeGit: true,
      install: false,
      name: "my-bot",
      packageManager: "pnpm",
      quiet: true,
      selectedAdapters: ["slack", "redis"],
      vendor: false,
      yes: true,
    });
  });

  it("passes --connect to runCli", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "create-chat-sdk",
      "my-bot",
      "--adapter",
      "slack",
      "--connect",
    ]);

    expect(runCli).toHaveBeenCalledWith(
      expect.objectContaining({ connect: true, selectedAdapters: ["slack"] })
    );
  });

  it("passes --vendor to runCli", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "--vendor"]);

    expect(determineAgent).not.toHaveBeenCalled();
    expect(runCli).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedAgent: undefined,
        vendor: true,
        yes: false,
      })
    );
  });

  it("rejects --vendor with explicit adapter selection", async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });

    await expect(
      program.parseAsync([
        "node",
        "create-chat-sdk",
        "my-bot",
        "--vendor",
        "--adapter",
        "slack",
      ])
    ).rejects.toThrow("cannot be used with option");
  });

  it("supports the short skip-install option", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "-s"]);

    expect(runCli).toHaveBeenCalledWith({
      connect: false,
      description: undefined,
      detectedAgent: undefined,
      force: false,
      initializeGit: true,
      install: false,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: false,
      yes: false,
    });
  });

  it("disables git initialization when requested", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "--no-git"]);

    expect(runCli).toHaveBeenCalledWith({
      connect: false,
      description: undefined,
      detectedAgent: undefined,
      force: false,
      initializeGit: false,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: false,
      yes: false,
    });
  });

  it("passes force when requested", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "-f"]);

    expect(runCli).toHaveBeenCalledWith({
      connect: false,
      description: undefined,
      detectedAgent: undefined,
      force: true,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: false,
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
      connect: false,
      description: undefined,
      detectedAgent: "cursor",
      force: false,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: false,
      yes: true,
    });
  });

  it("stays interactive with --interactive even when an agent is detected", async () => {
    // No detection mock needed: --interactive must skip detection entirely.
    const program = createProgram();
    await program.parseAsync([
      "node",
      "create-chat-sdk",
      "my-bot",
      "--interactive",
    ]);

    expect(determineAgent).not.toHaveBeenCalled();
    expect(runCli).toHaveBeenCalledWith(
      expect.objectContaining({ detectedAgent: undefined, yes: false })
    );
  });

  it("skips agent detection when --yes already decides the mode", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "-y"]);

    expect(determineAgent).not.toHaveBeenCalled();
    expect(runCli).toHaveBeenCalledWith(
      expect.objectContaining({ detectedAgent: undefined, yes: true })
    );
  });

  it("keeps explicit yes behavior outside agents", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot", "--yes"]);

    expect(runCli).toHaveBeenCalledWith({
      connect: false,
      description: undefined,
      detectedAgent: undefined,
      force: false,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: false,
      yes: true,
    });
  });

  it("passes default option values to runCli", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "create-chat-sdk", "my-bot"]);

    expect(runCli).toHaveBeenCalledWith({
      connect: false,
      description: undefined,
      detectedAgent: undefined,
      force: false,
      initializeGit: true,
      install: undefined,
      name: "my-bot",
      packageManager: undefined,
      quiet: false,
      selectedAdapters: undefined,
      vendor: false,
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
