import { describe, expect, it } from "vitest";
import { botTs } from "./templates.js";
import type { PlatformAdapter, ProjectConfig, StateAdapter } from "./types.js";

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

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-bot",
    description: "A test bot",
    platformAdapters: [slackAdapter],
    stateAdapter: memoryState,
    shouldInstall: false,
    packageManager: "npm",
    ...overrides,
  };
}

describe("botTs", () => {
  it("generates imports for each platform adapter", () => {
    const result = botTs(
      makeConfig({ platformAdapters: [slackAdapter, teamsAdapter] })
    );
    expect(result).toContain(
      'import { createSlackAdapter } from "@chat-adapter/slack";'
    );
    expect(result).toContain(
      'import { createTeamsAdapter } from "@chat-adapter/teams";'
    );
  });

  it("generates import for state adapter", () => {
    const result = botTs(makeConfig({ stateAdapter: redisState }));
    expect(result).toContain(
      'import { createRedisState } from "@chat-adapter/state-redis";'
    );
  });

  it("always imports Chat from 'chat'", () => {
    const result = botTs(makeConfig());
    expect(result).toContain('import { Chat } from "chat";');
  });

  it("creates adapter entries in the adapters block", () => {
    const result = botTs(
      makeConfig({ platformAdapters: [slackAdapter, teamsAdapter] })
    );
    expect(result).toContain("slack: createSlackAdapter(),");
    expect(result).toContain("teams: createTeamsAdapter(),");
  });

  it("uses empty adapters block when no platform adapters", () => {
    const result = botTs(makeConfig({ platformAdapters: [] }));
    expect(result).toContain("adapters: {},");
  });

  it("uses bot name from config", () => {
    const result = botTs(makeConfig({ name: "my-cool-bot" }));
    expect(result).toContain('"my-cool-bot"');
  });

  it("calls state factory in the state property", () => {
    const result = botTs(makeConfig({ stateAdapter: memoryState }));
    expect(result).toContain("state: createMemoryState(),");
  });

  it("includes onNewMention handler", () => {
    const result = botTs(makeConfig());
    expect(result).toContain("bot.onNewMention(");
    expect(result).toContain("await thread.subscribe();");
  });

  it("includes onSubscribedMessage handler", () => {
    const result = botTs(makeConfig());
    expect(result).toContain("bot.onSubscribedMessage(");
    expect(result).toContain("await thread.post(");
  });
});
