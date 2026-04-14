import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdaptersConfig, PlatformAdapter, StateAdapter } from "./types.js";

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  groupMultiselect: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === CANCEL),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import {
  confirm,
  groupMultiselect,
  isCancel,
  log,
  select,
  text,
} from "@clack/prompts";
import { runPrompts } from "./prompts.js";

const slackAdapter: PlatformAdapter = {
  name: "Slack",
  value: "slack",
  package: "@chat-adapter/slack",
  factoryFn: "createSlackAdapter",
  typeName: "SlackAdapter",
  category: "Messaging Platforms",
  envVars: [],
  serverExternalPackages: [],
};

const teamsAdapter: PlatformAdapter = {
  name: "Microsoft Teams",
  value: "teams",
  package: "@chat-adapter/teams",
  factoryFn: "createTeamsAdapter",
  typeName: "TeamsAdapter",
  category: "Messaging Platforms",
  envVars: [],
  serverExternalPackages: [],
};

const githubAdapter: PlatformAdapter = {
  name: "GitHub",
  value: "github",
  package: "@chat-adapter/github",
  factoryFn: "createGitHubAdapter",
  typeName: "GitHubAdapter",
  category: "Developer Tools",
  envVars: [],
  serverExternalPackages: [],
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

const adapters: AdaptersConfig = {
  platformAdapters: [slackAdapter, teamsAdapter, githubAdapter],
  stateAdapters: [memoryState, redisState],
};

function mockFullFlow(
  overrides: {
    name?: string;
    description?: string;
    platforms?: string[];
    state?: string;
    install?: boolean;
  } = {}
) {
  vi.mocked(text)
    .mockResolvedValueOnce(overrides.name ?? "my-bot")
    .mockResolvedValueOnce(overrides.description ?? "A bot");
  vi.mocked(groupMultiselect).mockResolvedValueOnce(
    overrides.platforms ?? ["slack"]
  );
  vi.mocked(select).mockResolvedValueOnce(overrides.state ?? "memory");
  vi.mocked(confirm).mockResolvedValueOnce(overrides.install ?? true);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCancel).mockImplementation((value: unknown) => value === CANCEL);
  process.env.npm_config_user_agent = "";
});

afterEach(() => {
  process.env.npm_config_user_agent = "";
});

describe("runPrompts", () => {
  describe("interactive flow", () => {
    it("returns full config from prompts", async () => {
      mockFullFlow();
      const result = await runPrompts(adapters);

      expect(result).toEqual({
        name: "my-bot",
        description: "A bot",
        platformAdapters: [slackAdapter],
        stateAdapter: memoryState,
        shouldInstall: true,
        packageManager: "npm",
      });
    });

    it("returns null when name is cancelled", async () => {
      vi.mocked(text).mockResolvedValueOnce(CANCEL as never);
      expect(await runPrompts(adapters)).toBeNull();
    });

    it("returns null when description is cancelled", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce(CANCEL as never);
      expect(await runPrompts(adapters)).toBeNull();
    });

    it("returns null when platform selection is cancelled", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(CANCEL as never);
      expect(await runPrompts(adapters)).toBeNull();
    });

    it("returns null when state selection is cancelled", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(select).mockResolvedValueOnce(CANCEL as never);
      expect(await runPrompts(adapters)).toBeNull();
    });

    it("returns null when install confirm is cancelled", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(select).mockResolvedValueOnce("memory");
      vi.mocked(confirm).mockResolvedValueOnce(CANCEL as never);
      expect(await runPrompts(adapters)).toBeNull();
    });

    it("throws when selected state adapter is not found", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(select).mockResolvedValueOnce("nonexistent");
      await expect(runPrompts(adapters)).rejects.toThrow(
        "Unknown state adapter: nonexistent"
      );
    });

    it("groups platform options by category", async () => {
      mockFullFlow();
      await runPrompts(adapters);

      const call = vi.mocked(groupMultiselect).mock.calls[0]?.[0];
      expect(call?.options).toEqual({
        "Messaging Platforms": [
          { label: "Slack", value: "slack" },
          { label: "Microsoft Teams", value: "teams" },
        ],
        "Developer Tools": [{ label: "GitHub", value: "github" }],
      });
    });
  });

  describe("flag overrides", () => {
    it("skips name prompt when initial name provided", async () => {
      vi.mocked(text).mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(select).mockResolvedValueOnce("memory");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const result = await runPrompts(adapters, "flagged-name");
      expect(result?.name).toBe("flagged-name");
      expect(vi.mocked(text)).toHaveBeenCalledTimes(1);
    });

    it("skips description prompt when initial description provided", async () => {
      mockFullFlow();
      const result = await runPrompts(adapters, undefined, "flagged desc");
      expect(result?.description).toBe("flagged desc");
      expect(vi.mocked(text)).toHaveBeenCalledTimes(1);
    });

    it("uses empty string when description prompt returns empty", async () => {
      vi.mocked(text).mockResolvedValueOnce("my-bot").mockResolvedValueOnce("");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(select).mockResolvedValueOnce("memory");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const result = await runPrompts(adapters);
      expect(result?.name).toBe("my-bot");
      expect(result?.description).toBe("");
    });

    it("skips platform prompt when adapters flagged", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(select).mockResolvedValueOnce("memory");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const result = await runPrompts(adapters, undefined, undefined, [
        "slack",
      ]);
      expect(result?.platformAdapters).toEqual([slackAdapter]);
      expect(groupMultiselect).not.toHaveBeenCalled();
    });

    it("skips state prompt when state adapter flagged", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const result = await runPrompts(adapters, undefined, undefined, [
        "slack",
        "redis",
      ]);
      expect(result?.stateAdapter).toEqual(redisState);
      expect(select).not.toHaveBeenCalled();
    });

    it("skips install prompt when --yes", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(select).mockResolvedValueOnce("memory");

      const result = await runPrompts(
        adapters,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      );
      expect(result?.shouldInstall).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("warns on unknown adapter flags", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(select).mockResolvedValueOnce("memory");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await runPrompts(adapters, undefined, undefined, ["slack", "bogus"]);
      expect(log.warn).toHaveBeenCalledWith("Unknown adapter(s): bogus");
    });

    it("warns on multiple state adapters and uses last", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(groupMultiselect).mockResolvedValueOnce(["slack"]);
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const result = await runPrompts(adapters, undefined, undefined, [
        "memory",
        "redis",
      ]);
      expect(log.warn).toHaveBeenCalledWith(
        'Multiple state adapters passed; using "redis"'
      );
      expect(result?.stateAdapter).toEqual(redisState);
    });

    it("logs selected adapters when not quiet", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await runPrompts(
        adapters,
        undefined,
        undefined,
        ["slack", "redis"],
        undefined,
        false,
        false
      );
      expect(log.info).toHaveBeenCalledWith("Platform adapters: Slack");
      expect(log.info).toHaveBeenCalledWith("State adapter: Redis");
    });

    it("suppresses info logs in quiet mode", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await runPrompts(
        adapters,
        undefined,
        undefined,
        ["slack", "redis"],
        undefined,
        false,
        true
      );
      expect(log.info).not.toHaveBeenCalled();
    });

    it("still prompts state when only platforms flagged", async () => {
      vi.mocked(text)
        .mockResolvedValueOnce("my-bot")
        .mockResolvedValueOnce("desc");
      vi.mocked(select).mockResolvedValueOnce("redis");
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const result = await runPrompts(adapters, undefined, undefined, [
        "slack",
      ]);
      expect(select).toHaveBeenCalled();
      expect(result?.stateAdapter).toEqual(redisState);
    });
  });

  describe("name validation", () => {
    it("validates empty name", async () => {
      mockFullFlow();
      await runPrompts(adapters);

      const textCall = vi.mocked(text).mock.calls[0]?.[0] as {
        validate?: (value: string) => string | undefined;
      };
      expect(textCall.validate?.("")).toBe("Project name is required");
      expect(textCall.validate?.("   ")).toBe("Project name is required");
    });

    it("validates invalid package name", async () => {
      mockFullFlow();
      await runPrompts(adapters);

      const textCall = vi.mocked(text).mock.calls[0]?.[0] as {
        validate?: (value: string) => string | undefined;
      };
      expect(textCall.validate?.("bad name!")).toBe("Invalid package name");
    });

    it("accepts valid package names", async () => {
      mockFullFlow();
      await runPrompts(adapters);

      const textCall = vi.mocked(text).mock.calls[0]?.[0] as {
        validate?: (value: string) => string | undefined;
      };
      expect(textCall.validate?.("my-bot")).toBeUndefined();
      expect(textCall.validate?.("my_bot.v2")).toBeUndefined();
      expect(textCall.validate?.("@scope-name")).toBeUndefined();
    });
  });

  describe("package manager detection", () => {
    it("detects pnpm", async () => {
      process.env.npm_config_user_agent = "pnpm/9.0.0";
      mockFullFlow();
      const result = await runPrompts(adapters);
      expect(result?.packageManager).toBe("pnpm");
    });

    it("detects yarn", async () => {
      process.env.npm_config_user_agent = "yarn/4.0.0";
      mockFullFlow();
      const result = await runPrompts(adapters);
      expect(result?.packageManager).toBe("yarn");
    });

    it("detects bun", async () => {
      process.env.npm_config_user_agent = "bun/1.0.0";
      mockFullFlow();
      const result = await runPrompts(adapters);
      expect(result?.packageManager).toBe("bun");
    });

    it("defaults to npm", async () => {
      mockFullFlow();
      const result = await runPrompts(adapters);
      expect(result?.packageManager).toBe("npm");
    });

    it("uses --pm override", async () => {
      process.env.npm_config_user_agent = "pnpm/9.0.0";
      mockFullFlow();
      const result = await runPrompts(
        adapters,
        undefined,
        undefined,
        undefined,
        "bun"
      );
      expect(result?.packageManager).toBe("bun");
    });
  });
});
