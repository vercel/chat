import {
  ADAPTER_NAMES,
  type CatalogAdapter,
  getAdapter,
  listEnvVars,
} from "chat/adapters";
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../types.js";
import { generateBotTs } from "./bot.js";
import { generateEnvExample } from "./env-example.js";
import { generateNextConfig } from "./next-config.js";
import { generatePackageJson } from "./package-json.js";
import { generateReadme } from "./readme.js";
import {
  generateAuthStub,
  generateDiscordGatewayRoute,
  generateVercelJson,
  generateWebRoute,
  needsDiscordGateway,
  needsVercelJson,
  needsWebRoute,
} from "./routes.js";

const adapter = (slug: string): CatalogAdapter => {
  const found = getAdapter(slug);
  if (!found) {
    throw new Error(`Missing test adapter: ${slug}`);
  }
  return found;
};

const makeConfig = (
  platformSlugs: readonly string[],
  stateSlug = "memory"
): ProjectConfig => ({
  description: "A generated bot",
  name: "test-bot",
  packageManager: "pnpm",
  platformAdapters: platformSlugs.map(adapter),
  shouldInstall: false,
  shouldInitializeGit: true,
  stateAdapter: adapter(stateSlug),
});

describe("generateBotTs", () => {
  it("generates zero-arg adapter calls", () => {
    const result = generateBotTs(makeConfig(["slack"]));
    expect(result).toContain(
      'import { createSlackAdapter } from "@chat-adapter/slack";'
    );
    expect(result).toContain("slack: createSlackAdapter(),");
    expect(result).toContain("state: createMemoryState(),");
  });

  it("generates empty-object calls", () => {
    const result = generateBotTs(makeConfig(["agentphone"]));
    expect(result).toContain("agentphone: createAgentPhoneAdapter({}),");
  });

  it("generates object calls with placeholders", () => {
    const result = generateBotTs(makeConfig(["resend"]));
    expect(result).toContain('fromAddress: "bot@example.com",');
    expect(result).toContain("Replace with a verified sender address.");
  });

  it("passes the required url to createIoRedisState without a logger", () => {
    const result = generateBotTs(makeConfig(["slack"], "ioredis"));
    expect(result).toContain('import { Chat } from "chat";');
    expect(result).toContain("state: createIoRedisState({");
    expect(result).toContain('url: process.env.REDIS_URL ?? "",');
    expect(result).not.toContain("ConsoleLogger");
    expect(result).not.toContain("logger:");
  });

  it("generates web adapter support", () => {
    const result = generateBotTs(makeConfig(["web"]));
    expect(result).toContain('import { getUser } from "./auth-stub";');
    expect(result).toContain("web: createWebAdapter({");
    expect(result).toContain("getUser,");
    expect(result).toContain("bot.onDirectMessage(");
  });

  it("generates every catalog adapter", () => {
    for (const slug of ADAPTER_NAMES) {
      const catalogAdapter = adapter(slug);
      const config =
        catalogAdapter.type === "state"
          ? makeConfig(["slack"], slug)
          : makeConfig([slug]);
      const result = generateBotTs(config);
      expect(result).toContain(catalogAdapter.factoryExport);
    }
  });
});

describe("Vercel Connect generation", () => {
  const connectConfig = (
    platformSlugs: readonly string[],
    stateSlug = "memory"
  ): ProjectConfig => ({
    ...makeConfig(platformSlugs, stateSlug),
    useConnect: true,
  });

  it("spreads the Connect helper into the adapter factory", () => {
    const result = generateBotTs(connectConfig(["slack"]));
    expect(result).toContain(
      'import { connectSlackAdapter } from "@vercel/connect/chat";'
    );
    expect(result).toContain("slack: createSlackAdapter({");
    expect(result).toContain(
      '...connectSlackAdapter(requireEnv("SLACK_CONNECTOR")),'
    );
  });

  it("fails loudly on a missing connector via requireEnv", () => {
    const result = generateBotTs(connectConfig(["slack"]));
    expect(result).toContain("const requireEnv = (name: string): string =>");
    expect(result).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the generated code contains this template literal verbatim
      "throw new Error(`Missing required environment variable: ${name}`);"
    );
  });

  it("omits the requireEnv helper when Connect is not used", () => {
    expect(generateBotTs(makeConfig(["slack"]))).not.toContain(
      "const requireEnv ="
    );
  });

  it("imports every selected Connect helper, sorted", () => {
    const result = generateBotTs(connectConfig(["slack", "github", "linear"]));
    expect(result).toContain(
      'import { connectGitHubAdapter, connectLinearAdapter, connectSlackAdapter } from "@vercel/connect/chat";'
    );
  });

  it("leaves non-Connect adapters on their native factory calls", () => {
    const result = generateBotTs(connectConfig(["slack", "discord"]));
    expect(result).toContain("discord: createDiscordAdapter(),");
    expect(result).toContain("slack: createSlackAdapter({");
  });

  it("ignores Connect helpers when useConnect is false", () => {
    const result = generateBotTs(makeConfig(["slack"]));
    expect(result).not.toContain("@vercel/connect/chat");
    expect(result).toContain("slack: createSlackAdapter(),");
  });

  it("adds the @vercel/connect dependency for Connect adapters", () => {
    const result = generatePackageJson(
      { dependencies: {} },
      connectConfig(["slack"])
    );
    expect(result.dependencies?.["@vercel/connect"]).toBe("latest");
  });

  it("does not add @vercel/connect without a Connect-capable adapter", () => {
    const result = generatePackageJson(
      { dependencies: {} },
      { ...makeConfig(["discord"]), useConnect: true }
    );
    expect(result.dependencies?.["@vercel/connect"]).toBeUndefined();
  });

  it("writes the connector env var and omits native secrets", () => {
    const result = generateEnvExample(connectConfig(["slack"]));
    expect(result).toContain("SLACK_CONNECTOR=");
    expect(result).toContain("VERCEL_OIDC_TOKEN");
    expect(result).not.toContain("SLACK_SIGNING_SECRET=");
    expect(result).not.toContain("SLACK_BOT_TOKEN=");
  });

  it("documents GITHUB_BOT_USER_ID for serverless GitHub Connect", () => {
    const result = generateEnvExample(connectConfig(["github"]));
    expect(result).toContain("GITHUB_CONNECTOR=");
    expect(result).toContain("GITHUB_BOT_USER_ID=");
  });

  it("documents Connect setup in the README", () => {
    const result = generateReadme(connectConfig(["slack"]));
    expect(result).toContain("Authentication (Vercel Connect)");
    expect(result).toContain("vercel env pull");
    expect(result).toContain("SLACK_CONNECTOR");
  });

  it("omits the README Connect section without a Connect-capable adapter", () => {
    const result = generateReadme({
      ...makeConfig(["discord"]),
      useConnect: true,
    });
    expect(result).not.toContain("Authentication (Vercel Connect)");
  });
});

describe("generateEnvExample", () => {
  it("includes env vars for selected adapters", () => {
    const result = generateEnvExample(makeConfig(["slack"], "redis"));
    expect(result).toContain("BOT_USERNAME=test-bot");
    expect(result).toContain("SLACK_SIGNING_SECRET=");
    expect(result).toContain("REDIS_URL=");
  });

  it("includes env vars read only by the generated bot.ts", () => {
    const result = generateEnvExample(makeConfig(["slack"], "ioredis"));
    expect(result).toContain("REDIS_URL=");
  });

  it("contains every selected adapter env key", () => {
    for (const slug of ADAPTER_NAMES) {
      const catalogAdapter = adapter(slug);
      const config =
        catalogAdapter.type === "state"
          ? makeConfig(["slack"], slug)
          : makeConfig([slug]);
      const result = generateEnvExample(config);
      for (const envVar of listEnvVars(slug)) {
        expect(result).toContain(`${envVar.key}=`);
      }
    }
  });
});

describe("generatePackageJson", () => {
  it("adds selected adapter dependencies", () => {
    const result = generatePackageJson(
      {
        dependencies: { next: "latest" },
        devDependencies: { typescript: "latest" },
      },
      makeConfig(["discord"], "redis")
    );
    expect(result.dependencies?.["@chat-adapter/discord"]).toBe("latest");
    expect(result.dependencies?.["@chat-adapter/state-redis"]).toBe("latest");
    expect(result.dependencies?.chat).toBe("latest");
  });

  it("does not duplicate official adapter provider SDKs (installed transitively)", () => {
    const result = generatePackageJson(
      { dependencies: {} },
      makeConfig(["discord", "slack"], "redis")
    );
    expect(result.dependencies?.["discord.js"]).toBeUndefined();
    expect(result.dependencies?.["@slack/web-api"]).toBeUndefined();
    expect(result.dependencies?.redis).toBeUndefined();
  });

  it("installs vendor-official adapter peer dependencies", () => {
    const result = generatePackageJson(
      { dependencies: {} },
      makeConfig(["resend"])
    );
    expect(result.dependencies?.["@resend/chat-sdk-adapter"]).toBe("latest");
    expect(result.dependencies?.["@chat-adapter/shared"]).toBe("latest");
  });

  it("removes empty descriptions", () => {
    const result = generatePackageJson(
      { description: "template", dependencies: {} },
      { ...makeConfig([]), description: "" }
    );
    expect(result.description).toBeUndefined();
  });

  it("handles templates without dependency objects", () => {
    const result = generatePackageJson({}, makeConfig([]));
    expect(result.dependencies?.chat).toBe("latest");
    expect(result.devDependencies).toBeUndefined();
  });
});

describe("generateNextConfig", () => {
  it("adds transpile packages and server externals", () => {
    const result = generateNextConfig(makeConfig(["discord"]));
    expect(result).toContain("transpilePackages");
    expect(result).toContain('"@chat-adapter/discord"');
    expect(result).toContain("serverExternalPackages");
    expect(result).toContain('"discord.js"');
  });
});

describe("route and README generators", () => {
  it("detects when the web route is needed", () => {
    expect(needsWebRoute(makeConfig(["web"]))).toBe(true);
    expect(needsWebRoute(makeConfig(["slack"]))).toBe(false);
  });

  it("generates web route and auth stub", () => {
    expect(generateWebRoute()).toContain("bot.webhooks.web");
    expect(generateAuthStub()).toContain("getUser");
  });

  it("generates selected endpoint documentation", () => {
    const result = generateReadme(makeConfig(["slack", "web"]));
    expect(result).toContain("/api/webhooks/slack");
    expect(result).toContain("/api/chat");
    expect(result).toContain("pnpm run dev");
  });

  it("documents the Discord Gateway endpoint when discord is selected", () => {
    const readme = generateReadme(makeConfig(["discord"]));
    expect(readme).toContain("/api/discord/gateway");
    expect(readme).toContain("requires Vercel Pro or Enterprise");
    expect(readme).toContain("pnpm run typecheck");
    expect(generateReadme(makeConfig(["slack"]))).not.toContain(
      "/api/discord/gateway"
    );
  });
});

describe("Discord Gateway generation", () => {
  it("detects when the Discord Gateway route is needed", () => {
    expect(needsDiscordGateway(makeConfig(["discord"]))).toBe(true);
    expect(needsDiscordGateway(makeConfig(["slack"]))).toBe(false);
  });

  it("generates a cron-authenticated Gateway route that forwards to the webhook", () => {
    const result = generateDiscordGatewayRoute();
    expect(result).toContain('bot.getAdapter("discord")');
    expect(result).toContain("startGatewayListener");
    expect(result).toContain("process.env.CRON_SECRET");
    expect(result).toContain("/api/webhooks/discord");
  });

  it("generates vercel.json crons only when discord is selected", () => {
    expect(needsVercelJson(makeConfig(["discord"]))).toBe(true);
    expect(needsVercelJson(makeConfig(["slack"]))).toBe(false);
    const vercelJson = JSON.parse(generateVercelJson(makeConfig(["discord"])));
    expect(vercelJson.crons).toEqual([
      { path: "/api/discord/gateway", schedule: "*/9 * * * *" },
    ]);
  });

  it("documents CRON_SECRET in .env.example for discord projects", () => {
    expect(generateEnvExample(makeConfig(["discord"]))).toContain(
      "CRON_SECRET="
    );
    expect(generateEnvExample(makeConfig(["slack"]))).not.toContain(
      "CRON_SECRET="
    );
  });
});
