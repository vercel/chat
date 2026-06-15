import { beforeEach, describe, expect, it, vi } from "vitest";

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  groupMultiselect: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === CANCEL),
  log: { info: vi.fn(), warning: vi.fn() },
  select: vi.fn(),
  text: vi.fn(),
}));

import { confirm, groupMultiselect, log, select, text } from "@clack/prompts";
import { runPrompts } from "./flow.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.npm_config_user_agent = "";
});

describe("runPrompts", () => {
  it("returns config from interactive prompts", async () => {
    vi.mocked(text)
      .mockResolvedValueOnce("my-bot")
      .mockResolvedValueOnce("desc");
    vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select).mockResolvedValueOnce("redis");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await runPrompts({ quiet: false, yes: false });

    expect(result?.name).toBe("my-bot");
    expect(result?.description).toBe("desc");
    expect(result?.platformAdapters.map((adapter) => adapter.slug)).toEqual([
      "slack",
    ]);
    expect(result?.shouldInitializeGit).toBe(true);
    expect(result?.stateAdapter.slug).toBe("redis");
    expect(result?.shouldInstall).toBe(true);
  });

  it("uses flagged adapters and logs the resolved selection", async () => {
    const result = await runPrompts({
      name: "my-bot",
      quiet: false,
      selectedAdapters: ["slack", "postgres"],
      yes: true,
    });

    expect(result?.stateAdapter.slug).toBe("postgres");
    expect(result?.shouldInitializeGit).toBe(true);
    expect(log.info).toHaveBeenCalledWith("Platform adapters: Slack");
    expect(log.info).toHaveBeenCalledWith("State adapter: PostgreSQL");
  });

  it("disables git initialization when requested", async () => {
    const result = await runPrompts({
      initializeGit: false,
      name: "my-bot",
      quiet: true,
      selectedAdapters: ["slack"],
      yes: true,
    });

    expect(result?.shouldInitializeGit).toBe(false);
  });

  it("requires a platform adapter in non-interactive mode", async () => {
    await expect(
      runPrompts({ name: "my-bot", quiet: true, yes: true })
    ).rejects.toThrow("at least one platform adapter");
  });

  it("rejects a state-only selection in non-interactive mode", async () => {
    await expect(
      runPrompts({
        name: "my-bot",
        quiet: true,
        selectedAdapters: ["redis"],
        yes: true,
      })
    ).rejects.toThrow("at least one platform adapter");
  });

  it("uses defaults in yes mode", async () => {
    const result = await runPrompts({
      name: "my-bot",
      packageManager: "bun",
      quiet: true,
      selectedAdapters: ["slack"],
      yes: true,
    });

    expect(result?.description).toBe("");
    expect(result?.platformAdapters.map((adapter) => adapter.slug)).toEqual([
      "slack",
    ]);
    expect(result?.stateAdapter.slug).toBe("memory");
    expect(result?.packageManager).toBe("bun");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not prompt for a project name in yes mode", async () => {
    const result = await runPrompts({
      quiet: true,
      selectedAdapters: ["slack"],
      yes: true,
    });

    expect(result?.name).toBe("my-bot");
    expect(text).not.toHaveBeenCalled();
  });

  it("returns null when prompts are cancelled", async () => {
    vi.mocked(text).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text)
      .mockResolvedValueOnce("my-bot")
      .mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(groupMultiselect).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(groupMultiselect).mockResolvedValueOnce([]);
    vi.mocked(select).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(groupMultiselect).mockResolvedValueOnce([]);
    vi.mocked(select).mockResolvedValueOnce("memory");
    vi.mocked(confirm).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();
  });

  it("validates initial names", async () => {
    await expect(
      runPrompts({ name: "bad name!", quiet: true, yes: true })
    ).rejects.toThrow("Use a valid npm package name");
  });
});
