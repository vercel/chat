import { beforeEach, describe, expect, it, vi } from "vitest";

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === CANCEL),
  log: { info: vi.fn(), warning: vi.fn() },
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

import { confirm, log, multiselect, select, text } from "@clack/prompts";
import { runPrompts } from "./flow.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.npm_config_user_agent = "";
});

describe("runPrompts", () => {
  it("returns config from interactive prompts with a flat official list", async () => {
    vi.mocked(text)
      .mockResolvedValueOnce("my-bot")
      .mockResolvedValueOnce("desc");
    vi.mocked(multiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select).mockResolvedValueOnce("redis");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await runPrompts({ quiet: false, yes: false });

    expect(multiselect).toHaveBeenCalled();
    expect(multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ value: "slack" }),
        ]),
      })
    );
    const options = vi.mocked(multiselect).mock.calls[0]?.[0].options ?? [];
    expect(options).toContainEqual({ label: "Discord", value: "discord" });
    expect(options.every((option) => !("hint" in option))).toBe(true);
    expect(result?.name).toBe("my-bot");
    expect(result?.description).toBe("desc");
    expect(result?.platformAdapters.map((adapter) => adapter.slug)).toEqual([
      "slack",
    ]);
    expect(result?.shouldInitializeGit).toBe(true);
    expect(result?.stateAdapter.slug).toBe("redis");
    expect(result?.shouldInstall).toBe(true);
  });

  it("shows only vendor-official adapters when --vendor is passed", async () => {
    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["agentphone"]);
    vi.mocked(select).mockResolvedValueOnce("memory");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await runPrompts({
      quiet: false,
      vendor: true,
      yes: false,
    });

    expect(multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ value: "agentphone" }),
        ]),
      })
    );
    const options = vi.mocked(multiselect).mock.calls[0]?.[0].options ?? [];
    expect(options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "slack" })])
    );
    expect(result?.platformAdapters.map((adapter) => adapter.slug)).toEqual([
      "agentphone",
    ]);
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

  it("warns when Discord requires a paid Vercel plan", async () => {
    const result = await runPrompts({
      name: "my-bot",
      quiet: false,
      selectedAdapters: ["discord"],
      yes: true,
    });

    expect(result?.platformAdapters[0]?.slug).toBe("discord");
    expect(log.warning).toHaveBeenCalledWith(
      expect.stringContaining("Vercel Pro or Enterprise")
    );
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
    vi.mocked(multiselect).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select).mockResolvedValueOnce("memory");
    vi.mocked(confirm).mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();

    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select)
      .mockResolvedValueOnce("memory")
      .mockResolvedValueOnce(CANCEL as never);
    expect(await runPrompts({ quiet: false, yes: false })).toBeNull();
  });

  it("validates initial names", async () => {
    await expect(
      runPrompts({ name: "bad name!", quiet: true, yes: true })
    ).rejects.toThrow("Use a valid npm package name");
  });

  it("prompts for auth mode and applies Vercel Connect when chosen", async () => {
    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select)
      .mockResolvedValueOnce("memory")
      .mockResolvedValueOnce("connect");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await runPrompts({ quiet: false, yes: false });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "How should adapters authenticate?",
        options: expect.arrayContaining([
          expect.objectContaining({ value: "connect" }),
        ]),
      })
    );
    expect(result?.useConnect).toBe(true);
  });

  it("keeps provider secrets when the auth-mode prompt selects secrets", async () => {
    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["slack"]);
    vi.mocked(select)
      .mockResolvedValueOnce("memory")
      .mockResolvedValueOnce("secrets");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await runPrompts({ quiet: false, yes: false });

    expect(result?.useConnect).toBe(false);
  });

  it("does not prompt for auth mode without a Connect-capable adapter", async () => {
    vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
    vi.mocked(multiselect).mockResolvedValueOnce(["discord"]);
    vi.mocked(select).mockResolvedValueOnce("memory");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await runPrompts({ quiet: false, yes: false });

    expect(select).toHaveBeenCalledTimes(1);
    expect(result?.useConnect).toBe(false);
  });

  it("enables Vercel Connect with --connect on a flagged selection", async () => {
    const result = await runPrompts({
      connect: true,
      name: "my-bot",
      quiet: true,
      selectedAdapters: ["slack", "memory"],
      yes: true,
    });

    expect(result?.useConnect).toBe(true);
  });

  it("ignores --connect when no Connect-capable adapter is selected", async () => {
    const result = await runPrompts({
      connect: true,
      name: "my-bot",
      quiet: false,
      selectedAdapters: ["discord", "memory"],
      yes: true,
    });

    expect(result?.useConnect).toBe(false);
    expect(log.warning).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring --connect")
    );
  });
});
