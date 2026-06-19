import { type AdapterSlug, isAdapterSlug } from "chat/adapters";
import { AdapterSelectionError } from "../errors.js";

/**
 * Reusable factory-call shapes supported by the `bot.ts` generator.
 *
 * Use `zero-arg` for adapters whose factory auto-detects all configuration
 * from environment variables, `empty-object` when passing an object is clearer
 * for future user edits, `object` when the scaffold should emit concrete
 * properties, and `web-server` for the Web adapter's server-side `getUser`
 * callback wiring.
 */
export type ScaffoldInvocation =
  | { kind: "zero-arg" }
  | { kind: "empty-object" }
  | { kind: "object"; properties: readonly ScaffoldProperty[] }
  | { kind: "web-server" };

/**
 * A property emitted into an object-style factory call.
 */
export interface ScaffoldProperty {
  /**
   * JavaScript object property key.
   */
  key: string;
  /**
   * Value expression emitted for this property.
   */
  value: ScaffoldPropertyValue;
}

/**
 * Supported value expression shapes for generated object properties.
 *
 * `env` renders a `process.env.NAME ?? fallback` expression, `literal` renders
 * trusted TypeScript exactly as provided, and `placeholder` renders a TODO
 * comment plus editable starter code for values the CLI cannot infer safely.
 */
export type ScaffoldPropertyValue =
  | { kind: "env"; name: string; fallback: string }
  | { kind: "literal"; code: string }
  | { kind: "placeholder"; code: string; comment?: string };

/**
 * create-chat-sdk-only code generation policy for one adapter.
 */
export interface CliScaffoldSpec {
  /**
   * Additional runtime dependencies to install beyond catalog package metadata.
   */
  extraDependencies?: readonly string[];
  /**
   * Factory invocation shape used in generated `src/lib/bot.ts`.
   */
  invocation: ScaffoldInvocation;
  /**
   * Packages that Next.js should keep external on the server.
   */
  serverExternalPackages?: readonly string[];
  /**
   * Short hint displayed beside state adapters in the prompt.
   */
  stateHint?: string;
}

const env = (name: string, fallback = '""'): ScaffoldPropertyValue => ({
  kind: "env",
  name,
  fallback,
});

const literal = (code: string): ScaffoldPropertyValue => ({
  code,
  kind: "literal",
});

const placeholder = (code: string, comment = ""): ScaffoldPropertyValue => ({
  comment,
  code,
  kind: "placeholder",
});

/**
 * Exhaustive CLI scaffold policy keyed by the canonical adapter catalog slug.
 */
export const CLI_SCAFFOLD_SPEC = {
  agentphone: {
    invocation: { kind: "empty-object" },
  },
  discord: {
    invocation: { kind: "zero-arg" },
    serverExternalPackages: [
      "discord.js",
      "@discordjs/ws",
      "@discordjs/voice",
      "zlib-sync",
      "bufferutil",
      "utf-8-validate",
    ],
  },
  gchat: {
    invocation: { kind: "zero-arg" },
  },
  github: {
    invocation: { kind: "zero-arg" },
  },
  ioredis: {
    // createIoRedisState needs an explicit url (no REDIS_URL auto-detection).
    // The logger is optional and defaults to a console logger when omitted.
    invocation: {
      kind: "object",
      properties: [{ key: "url", value: env("REDIS_URL") }],
    },
    stateHint: "production - ioredis driver",
  },
  kapso: {
    invocation: {
      kind: "object",
      properties: [
        { key: "kapsoApiKey", value: env("KAPSO_API_KEY") },
        { key: "phoneNumberId", value: env("KAPSO_PHONE_NUMBER_ID") },
        { key: "webhookSecret", value: env("KAPSO_WEBHOOK_SECRET") },
      ],
    },
  },
  lark: {
    invocation: { kind: "zero-arg" },
  },
  linear: {
    invocation: { kind: "zero-arg" },
  },
  liveblocks: {
    invocation: {
      kind: "object",
      properties: [
        { key: "apiKey", value: env("LIVEBLOCKS_SECRET_KEY") },
        { key: "webhookSecret", value: env("LIVEBLOCKS_WEBHOOK_SECRET") },
        {
          key: "botUserId",
          value: placeholder(
            '"chat-sdk-bot"',
            "Replace with the Liveblocks user ID for your bot."
          ),
        },
        {
          key: "botUserName",
          value: literal('process.env.BOT_USERNAME ?? "chat-sdk-bot"'),
        },
      ],
    },
  },
  matrix: {
    invocation: { kind: "zero-arg" },
  },
  memory: {
    invocation: { kind: "zero-arg" },
    stateHint: "development only",
  },
  messenger: {
    invocation: { kind: "zero-arg" },
  },
  novu: {
    invocation: { kind: "zero-arg" },
  },
  postgres: {
    invocation: { kind: "zero-arg" },
    stateHint: "production - PostgreSQL",
  },
  redis: {
    invocation: { kind: "zero-arg" },
    stateHint: "production - node-redis driver",
  },
  resend: {
    invocation: {
      kind: "object",
      properties: [
        {
          key: "fromAddress",
          value: placeholder(
            '"bot@example.com"',
            "Replace with a verified sender address."
          ),
        },
      ],
    },
  },
  sendblue: {
    invocation: { kind: "zero-arg" },
  },
  slack: {
    invocation: { kind: "zero-arg" },
  },
  teams: {
    invocation: {
      kind: "object",
      properties: [{ key: "appType", value: literal('"SingleTenant"') }],
    },
  },
  telegram: {
    invocation: { kind: "zero-arg" },
  },
  twilio: {
    invocation: { kind: "zero-arg" },
  },
  velt: {
    invocation: {
      kind: "object",
      properties: [
        { key: "apiKey", value: env("VELT_API_KEY") },
        { key: "webhookSecret", value: env("VELT_WEBHOOK_SECRET") },
        {
          key: "botUserId",
          value: placeholder(
            '"velt-bot"',
            "Replace with the Velt user ID for your bot."
          ),
        },
        {
          key: "botUserName",
          value: literal('process.env.BOT_USERNAME ?? "chat-sdk-bot"'),
        },
      ],
    },
  },
  web: {
    extraDependencies: ["ai"],
    invocation: { kind: "web-server" },
  },
  whatsapp: {
    invocation: { kind: "zero-arg" },
  },
  zernio: {
    invocation: { kind: "zero-arg" },
  },
} as const satisfies Record<AdapterSlug, CliScaffoldSpec>;

/**
 * Look up create-chat-sdk-specific scaffold policy for an adapter.
 *
 * @param slug - Catalog adapter slug.
 * @returns The scaffold policy for the adapter.
 */
export const getCliScaffoldSpec = (slug: string): CliScaffoldSpec => {
  if (!isAdapterSlug(slug)) {
    throw new AdapterSelectionError(`Missing scaffold spec for ${slug}`);
  }
  return CLI_SCAFFOLD_SPEC[slug];
};
