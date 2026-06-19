/**
 * Static catalog of official and vendor-official Chat SDK adapters.
 *
 * This module imports no adapter packages and no provider SDKs, so it is safe
 * to use from build scripts, setup screens, and onboarding flows that only need
 * package metadata and environment-variable requirements.
 *
 * @example List every cataloged adapter.
 * ```typescript
 * import { ADAPTER_NAMES, getAdapter } from "chat/adapters";
 *
 * for (const slug of ADAPTER_NAMES) {
 *   const adapter = getAdapter(slug);
 *   console.log(adapter.name, adapter.packageName);
 * }
 * ```
 *
 * @example Find secrets for one adapter.
 * ```typescript
 * import { getSecretEnvVars } from "chat/adapters";
 *
 * const keys = getSecretEnvVars("slack").map((envVar) => envVar.key);
 * ```
 */

/**
 * A single environment variable referenced by an adapter.
 */
export interface EnvVar {
  /**
   * Alternative variable names accepted for the same value.
   */
  aliases?: readonly string[];
  /**
   * Short description of what the value configures.
   */
  description: string;
  /**
   * Canonical environment variable name.
   */
  key: string;
  /**
   * Whether the value is a credential, token, secret, or password that should
   * be masked in logs and user interfaces.
   */
  secret: boolean;
}

/**
 * One self-contained way to satisfy an adapter's credential requirements.
 *
 * Use {@link AdapterEnvSpec.credentialModes} when an adapter supports multiple
 * mutually exclusive authentication paths.
 */
export interface EnvGroup {
  /**
   * Human-readable name for this credential mode.
   */
  label: string;
  /**
   * Variables that together satisfy this mode.
   */
  vars: readonly EnvVar[];
}

/**
 * Environment variables and constructor-only configuration for an adapter.
 */
export interface AdapterEnvSpec {
  /**
   * Constructor options that have no environment-variable equivalent.
   */
  config?: readonly string[];
  /**
   * Mutually exclusive credential modes. A caller usually satisfies exactly
   * one group.
   */
  credentialModes?: readonly EnvGroup[];
  /**
   * Additional caveats that do not fit the structured fields.
   */
  notes?: string;
  /**
   * Optional environment variables that tune behavior but are safe to omit.
   */
  optional?: readonly EnvVar[];
  /**
   * Variables needed regardless of credential mode.
   */
  required?: readonly EnvVar[];
}

/**
 * Metadata for one cataloged Chat SDK adapter.
 */
export interface CatalogAdapter {
  /**
   * One-line summary of what the adapter connects to.
   */
  description: string;
  /**
   * Environment variables and constructor-only configuration.
   */
  env: AdapterEnvSpec;
  /**
   * Named factory export from {@link CatalogAdapter.packageName}.
   */
  factoryExport: string;
  /**
   * Catalog group used by the docs adapter listing.
   */
  group: "official" | "vendor-official";
  /**
   * Display name.
   */
  name: string;
  /**
   * NPM package that provides the adapter implementation.
   */
  packageName: string;
  /**
   * Runtime packages the adapter expects the consuming app to provide or
   * install alongside it.
   */
  peerDeps: readonly string[];
  /**
   * Stable catalog slug.
   */
  slug: string;
  /**
   * Whether the adapter connects to a messaging platform or stores Chat SDK
   * state.
   */
  type: "platform" | "state";
}

const env = (
  key: string,
  description: string,
  options: { aliases?: readonly string[]; secret?: boolean } = {}
): EnvVar => ({
  ...(options.aliases ? { aliases: options.aliases } : {}),
  description,
  key,
  secret: options.secret ?? false,
});

// Readability marker for non-secret URL variables; behavior intentionally
// matches env().
const urlEnv = (
  key: string,
  description: string,
  options: { aliases?: readonly string[] } = {}
): EnvVar => env(key, description, options);

const secretEnv = (
  key: string,
  description: string,
  options: { aliases?: readonly string[] } = {}
): EnvVar => env(key, description, { ...options, secret: true });

const redisUrlEnv = urlEnv(
  "REDIS_URL",
  "Redis connection URL used when a client is not provided."
);

const postgresUrlEnv = urlEnv(
  "POSTGRES_URL",
  "Postgres connection URL used when a client is not provided.",
  { aliases: ["DATABASE_URL"] }
);

/**
 * Official and vendor-official adapters keyed by slug.
 */
export const ADAPTERS = {
  agentphone: {
    description:
      "Unified SMS, MMS, iMessage, and voice adapter for Chat SDK with HMAC-verified webhooks, iMessage reactions, and voice call transcripts via AgentPhone.",
    env: {
      config: ["apiUrl", "userName"],
      optional: [
        secretEnv(
          "AGENTPHONE_WEBHOOK_SECRET",
          "Webhook signing secret for HMAC-SHA256 verification."
        ),
      ],
      required: [
        secretEnv("AGENTPHONE_API_KEY", "AgentPhone API key."),
        env("AGENTPHONE_AGENT_ID", "Agent ID used to send messages."),
      ],
    },
    factoryExport: "createAgentPhoneAdapter",
    group: "vendor-official",
    name: "AgentPhone",
    packageName: "@agentphone/chat-sdk-adapter",
    peerDeps: [],
    slug: "agentphone",
    type: "platform",
  },
  discord: {
    description:
      "Create Discord bots with slash commands, threads, and rich embeds.",
    env: {
      optional: [
        env(
          "DISCORD_MENTION_ROLE_IDS",
          "Comma-separated role IDs that should trigger mention handlers."
        ),
        urlEnv("DISCORD_API_URL", "Override the Discord API base URL."),
      ],
      required: [
        secretEnv("DISCORD_BOT_TOKEN", "Discord bot token."),
        env("DISCORD_PUBLIC_KEY", "Application public key."),
        env("DISCORD_APPLICATION_ID", "Discord application ID."),
      ],
    },
    factoryExport: "createDiscordAdapter",
    group: "official",
    name: "Discord",
    packageName: "@chat-adapter/discord",
    peerDeps: ["discord-api-types", "discord-interactions", "discord.js"],
    slug: "discord",
    type: "platform",
  },
  github: {
    description:
      "Build bots that respond to pull request and issue comment threads.",
    env: {
      credentialModes: [
        {
          label: "Personal access token",
          vars: [secretEnv("GITHUB_TOKEN", "Personal access token.")],
        },
        {
          label: "GitHub App",
          vars: [
            env("GITHUB_APP_ID", "GitHub App ID."),
            secretEnv("GITHUB_PRIVATE_KEY", "GitHub App private key."),
          ],
        },
      ],
      optional: [
        env(
          "GITHUB_INSTALLATION_ID",
          "Installation ID for single-installation app deployments."
        ),
        env("GITHUB_BOT_USERNAME", "Bot username for mention detection."),
        urlEnv("GITHUB_API_URL", "Override the GitHub API base URL."),
      ],
      required: [secretEnv("GITHUB_WEBHOOK_SECRET", "Webhook signing secret.")],
    },
    factoryExport: "createGitHubAdapter",
    group: "official",
    name: "GitHub",
    packageName: "@chat-adapter/github",
    peerDeps: ["@octokit/auth-app", "@octokit/rest"],
    slug: "github",
    type: "platform",
  },
  gchat: {
    description:
      "Integrate with Google Chat spaces for team collaboration and automated workflows.",
    env: {
      credentialModes: [
        {
          label: "Service account credentials",
          vars: [
            secretEnv(
              "GOOGLE_CHAT_CREDENTIALS",
              "Service account credentials JSON or path."
            ),
          ],
        },
        {
          label: "Application Default Credentials",
          vars: [
            env(
              "GOOGLE_CHAT_USE_ADC",
              "Set to true to use Application Default Credentials."
            ),
          ],
        },
      ],
      optional: [
        env("GOOGLE_CHAT_PUBSUB_TOPIC", "Pub/Sub topic for Workspace Events."),
        env(
          "GOOGLE_CHAT_IMPERSONATE_USER",
          "User email for domain-wide delegation."
        ),
        env(
          "GOOGLE_CHAT_PROJECT_NUMBER",
          "Google Cloud project number for signature validation."
        ),
        env(
          "GOOGLE_CHAT_PUBSUB_AUDIENCE",
          "Audience used for Workspace Events push verification."
        ),
        env(
          "GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION",
          "Set to true to disable signature verification for local fixtures."
        ),
        urlEnv("GOOGLE_CHAT_API_URL", "Override the Google Chat API URL."),
      ],
    },
    factoryExport: "createGoogleChatAdapter",
    group: "official",
    name: "Google Chat",
    packageName: "@chat-adapter/gchat",
    peerDeps: ["@googleapis/chat", "@googleapis/workspaceevents"],
    slug: "gchat",
    type: "platform",
  },
  ioredis: {
    description:
      "Redis state adapter using ioredis with cluster and sentinel support.",
    env: {
      config: ["url or client", "keyPrefix"],
      notes: "Either a Redis URL or an existing ioredis client is required.",
    },
    factoryExport: "createIoRedisState",
    group: "official",
    name: "ioredis",
    packageName: "@chat-adapter/state-ioredis",
    peerDeps: ["ioredis"],
    slug: "ioredis",
    type: "state",
  },
  kapso: {
    description:
      "Kapso-first WhatsApp adapter for Chat SDK with signed Kapso webhooks, WhatsApp replies, buttons, media, reactions, and conversation history.",
    env: {
      config: [
        "client",
        "verifyWebhookSignatures",
        "appSecret",
        "webhookVerifyToken",
        "historyFields",
        "cacheSize",
        "logger",
        "debug",
      ],
      optional: [
        env(
          "KAPSO_PHONE_NUMBER_ID",
          "WhatsApp phone number ID connected in Kapso."
        ),
        secretEnv(
          "KAPSO_WEBHOOK_SECRET",
          "Secret used to verify Kapso webhook deliveries."
        ),
        urlEnv("KAPSO_BASE_URL", "Kapso proxy URL."),
        env("KAPSO_BOT_USERNAME", "Bot display name."),
      ],
      required: [
        secretEnv(
          "KAPSO_API_KEY",
          "Kapso API key used for sends, history, contacts, conversations, and media."
        ),
      ],
    },
    factoryExport: "createKapsoAdapter",
    group: "vendor-official",
    name: "Kapso",
    packageName: "@kapso/chat-adapter",
    peerDeps: [],
    slug: "kapso",
    type: "platform",
  },
  lark: {
    description:
      "Lark / Feishu adapter for Chat SDK with native cardkit streaming, interactive cards, and reactions.",
    env: {
      optional: [env("LARK_BOT_USERNAME", "Bot display name.")],
      required: [
        env("LARK_APP_ID", "Lark app ID."),
        secretEnv("LARK_APP_SECRET", "Lark app secret."),
      ],
    },
    factoryExport: "createLarkAdapter",
    group: "vendor-official",
    name: "Lark / Feishu",
    packageName: "@larksuite/vercel-chat-adapter",
    peerDeps: [],
    slug: "lark",
    type: "platform",
  },
  linear: {
    description:
      "Automate Linear issue comment threads with bot responses and workflows.",
    env: {
      credentialModes: [
        {
          label: "Personal API key",
          vars: [secretEnv("LINEAR_API_KEY", "Personal API key.")],
        },
        {
          label: "Access token",
          vars: [
            secretEnv(
              "LINEAR_ACCESS_TOKEN",
              "Pre-obtained OAuth access token."
            ),
          ],
        },
        {
          label: "Client credentials",
          vars: [
            env(
              "LINEAR_CLIENT_CREDENTIALS_CLIENT_ID",
              "Client credentials OAuth client ID."
            ),
            secretEnv(
              "LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET",
              "Client credentials OAuth client secret."
            ),
          ],
        },
        {
          label: "OAuth app",
          vars: [
            env("LINEAR_CLIENT_ID", "OAuth client ID."),
            secretEnv("LINEAR_CLIENT_SECRET", "OAuth client secret."),
          ],
        },
      ],
      optional: [
        env(
          "LINEAR_CLIENT_CREDENTIALS_SCOPES",
          "Space-delimited scopes for client-credentials auth."
        ),
        secretEnv(
          "LINEAR_ENCRYPTION_KEY",
          "AES-256-GCM key for encrypting stored OAuth tokens."
        ),
        env("LINEAR_BOT_USERNAME", "Bot display name."),
        urlEnv("LINEAR_API_URL", "Override the Linear API URL."),
      ],
      required: [secretEnv("LINEAR_WEBHOOK_SECRET", "Webhook signing secret.")],
    },
    factoryExport: "createLinearAdapter",
    group: "official",
    name: "Linear",
    packageName: "@chat-adapter/linear",
    peerDeps: ["@linear/sdk"],
    slug: "linear",
    type: "platform",
  },
  liveblocks: {
    description:
      "Liveblocks Comments adapter for building conversational bots on top of Liveblocks rooms, threads, and comments.",
    env: {
      config: ["botUserId", "botUserName", "resolveUsers", "resolveGroupsInfo"],
      required: [
        secretEnv("LIVEBLOCKS_SECRET_KEY", "Liveblocks secret key."),
        secretEnv(
          "LIVEBLOCKS_WEBHOOK_SECRET",
          "Liveblocks webhook signing secret."
        ),
      ],
    },
    factoryExport: "createLiveblocksAdapter",
    group: "vendor-official",
    name: "Liveblocks",
    packageName: "@liveblocks/chat-sdk-adapter",
    peerDeps: [],
    slug: "liveblocks",
    type: "platform",
  },
  matrix: {
    description: "Matrix adapter for Chat SDK, built and maintained by Beeper.",
    env: {
      config: [
        "recoveryKey",
        "commandPrefix",
        "roomAllowlist",
        "inviteAutoJoin",
        "e2ee",
        "persistence",
      ],
      credentialModes: [
        {
          label: "Access token",
          vars: [
            urlEnv("MATRIX_BASE_URL", "Matrix homeserver base URL."),
            secretEnv("MATRIX_ACCESS_TOKEN", "Matrix access token."),
          ],
        },
        {
          label: "Username and password",
          vars: [
            urlEnv("MATRIX_BASE_URL", "Matrix homeserver base URL."),
            env("MATRIX_USERNAME", "Matrix username."),
            secretEnv("MATRIX_PASSWORD", "Matrix password."),
          ],
        },
      ],
      optional: [
        env("MATRIX_USER_ID", "User ID hint."),
        env("MATRIX_DEVICE_ID", "Explicit device ID override."),
        secretEnv(
          "MATRIX_RECOVERY_KEY",
          "Enables E2EE and key-backup bootstrap."
        ),
        env("MATRIX_BOT_USERNAME", "Mention-detection username."),
        env("MATRIX_COMMAND_PREFIX", "Slash command prefix."),
        env("MATRIX_INVITE_AUTOJOIN", "Enable invite auto-join."),
        env(
          "MATRIX_INVITE_AUTOJOIN_ALLOWLIST",
          "Comma-separated Matrix user IDs allowed to invite the bot."
        ),
        env("MATRIX_SDK_LOG_LEVEL", "Matrix SDK log level."),
      ],
    },
    factoryExport: "createMatrixAdapter",
    group: "vendor-official",
    name: "Beeper Matrix",
    packageName: "@beeper/chat-adapter-matrix",
    peerDeps: [],
    slug: "matrix",
    type: "platform",
  },
  memory: {
    description:
      "In-memory state adapter for development and testing environments.",
    env: {
      notes:
        "No environment variables are required. State is kept in the current process.",
    },
    factoryExport: "createMemoryState",
    group: "official",
    name: "Memory",
    packageName: "@chat-adapter/state-memory",
    peerDeps: [],
    slug: "memory",
    type: "state",
  },
  messenger: {
    description:
      "Build bots for Facebook Messenger with support for templates, buttons, reactions, and postbacks.",
    env: {
      config: ["apiVersion", "userName"],
      required: [
        secretEnv(
          "FACEBOOK_APP_SECRET",
          "App secret for webhook signature verification."
        ),
        secretEnv(
          "FACEBOOK_PAGE_ACCESS_TOKEN",
          "Page access token for the Send API."
        ),
        secretEnv("FACEBOOK_VERIFY_TOKEN", "Webhook verification token."),
      ],
    },
    factoryExport: "createMessengerAdapter",
    group: "official",
    name: "Messenger",
    packageName: "@chat-adapter/messenger",
    peerDeps: [],
    slug: "messenger",
    type: "platform",
  },
  novu: {
    description:
      "Multi-channel agents with one-click channel setup, identity and multi-tenancy",
    env: {
      optional: [
        urlEnv(
          "NOVU_API_BASE_URL",
          "API base URL. Defaults to https://api.novu.co."
        ),
      ],
      required: [
        secretEnv(
          "NOVU_SECRET_KEY",
          "Novu API key that authorizes replies and verifies the inbound HMAC. Set automatically by npx novu connect."
        ),
        env(
          "NOVU_AGENT_IDENTIFIER",
          "Bridge agent ID set automatically by npx novu connect."
        ),
      ],
    },
    factoryExport: "createNovuAdapter",
    group: "vendor-official",
    name: "Novu",
    packageName: "@novu/chat-sdk-adapter",
    peerDeps: [],
    slug: "novu",
    type: "platform",
  },
  postgres: {
    description:
      "Production state adapter using PostgreSQL for persistence and distributed locking.",
    env: {
      config: ["client", "keyPrefix", "schemaName"],
      credentialModes: [
        {
          label: "Connection URL",
          vars: [postgresUrlEnv],
        },
        {
          label: "Existing client",
          vars: [],
        },
      ],
    },
    factoryExport: "createPostgresState",
    group: "official",
    name: "PostgreSQL",
    packageName: "@chat-adapter/state-pg",
    peerDeps: ["pg"],
    slug: "postgres",
    type: "state",
  },
  redis: {
    description:
      "Production-ready state adapter using Redis for persistence and distributed locking.",
    env: {
      config: ["client", "keyPrefix"],
      credentialModes: [
        {
          label: "Connection URL",
          vars: [redisUrlEnv],
        },
        {
          label: "Existing client",
          vars: [],
        },
      ],
    },
    factoryExport: "createRedisState",
    group: "official",
    name: "Redis",
    packageName: "@chat-adapter/state-redis",
    peerDeps: ["redis"],
    slug: "redis",
    type: "state",
  },
  resend: {
    description:
      "Bidirectional email adapter for Chat SDK with threading, rich HTML emails, and attachment support via Resend.",
    env: {
      config: ["fromAddress", "fromName"],
      required: [
        secretEnv("RESEND_API_KEY", "Resend API key."),
        secretEnv("RESEND_WEBHOOK_SECRET", "Resend webhook signing secret."),
      ],
    },
    factoryExport: "createResendAdapter",
    group: "vendor-official",
    name: "Resend",
    packageName: "@resend/chat-sdk-adapter",
    peerDeps: ["@chat-adapter/shared"],
    slug: "resend",
    type: "platform",
  },
  sendblue: {
    description:
      "iMessage, SMS, and RCS adapter for Chat SDK, built and maintained by Sendblue.",
    env: {
      config: ["webhookSecretHeader", "allowedServices"],
      optional: [
        secretEnv(
          "SENDBLUE_WEBHOOK_SECRET",
          "Shared secret for webhook verification."
        ),
        urlEnv(
          "SENDBLUE_STATUS_CALLBACK_URL",
          "Status callback URL for outbound delivery events."
        ),
      ],
      required: [
        secretEnv("SENDBLUE_API_KEY", "Sendblue API key ID."),
        secretEnv("SENDBLUE_API_SECRET", "Sendblue API secret key."),
        env("SENDBLUE_FROM_NUMBER", "Sendblue sender number in E.164 format."),
      ],
    },
    factoryExport: "createSendblueAdapter",
    group: "vendor-official",
    name: "Sendblue",
    packageName: "chat-adapter-sendblue",
    peerDeps: [],
    slug: "sendblue",
    type: "platform",
  },
  slack: {
    description:
      "Build bots for Slack workspaces with full support for threads, reactions, and interactive messages.",
    env: {
      credentialModes: [
        {
          label: "Single workspace bot token",
          vars: [
            secretEnv("SLACK_BOT_TOKEN", "Slack bot token."),
            secretEnv(
              "SLACK_SIGNING_SECRET",
              "Slack signing secret for webhook verification."
            ),
          ],
        },
        {
          label: "Multi-workspace OAuth",
          vars: [
            env("SLACK_CLIENT_ID", "Slack app client ID."),
            secretEnv("SLACK_CLIENT_SECRET", "Slack app client secret."),
            secretEnv(
              "SLACK_SIGNING_SECRET",
              "Slack signing secret for webhook verification."
            ),
          ],
        },
      ],
      optional: [
        secretEnv("SLACK_APP_TOKEN", "Slack app-level token for Socket Mode."),
        secretEnv(
          "SLACK_ENCRYPTION_KEY",
          "AES-256-GCM key for encrypting stored OAuth tokens."
        ),
        urlEnv("SLACK_API_URL", "Override the Slack API base URL."),
        secretEnv(
          "SLACK_SOCKET_FORWARDING_SECRET",
          "Secret used to authenticate forwarded Socket Mode events."
        ),
      ],
    },
    factoryExport: "createSlackAdapter",
    group: "official",
    name: "Slack",
    packageName: "@chat-adapter/slack",
    peerDeps: ["@slack/socket-mode", "@slack/web-api"],
    slug: "slack",
    type: "platform",
  },
  teams: {
    description:
      "Deploy bots to Microsoft Teams with adaptive cards, mentions, and conversation threading.",
    env: {
      credentialModes: [
        {
          label: "Bot Framework client secret",
          vars: [
            env("TEAMS_APP_ID", "Azure Bot App ID."),
            secretEnv("TEAMS_APP_PASSWORD", "Azure Bot App password."),
          ],
        },
      ],
      optional: [
        env(
          "TEAMS_APP_TENANT_ID",
          "Azure AD tenant ID for single-tenant apps."
        ),
        urlEnv(
          "TEAMS_API_URL",
          "Override the Teams API base URL for sovereign clouds."
        ),
      ],
    },
    factoryExport: "createTeamsAdapter",
    group: "official",
    name: "Microsoft Teams",
    packageName: "@chat-adapter/teams",
    peerDeps: [
      "@microsoft/teams.api",
      "@microsoft/teams.apps",
      "@microsoft/teams.cards",
      "@microsoft/teams.graph-endpoints",
    ],
    slug: "teams",
    type: "platform",
  },
  telegram: {
    description:
      "Connect to Telegram with support for groups, channels, and inline keyboards.",
    env: {
      optional: [
        secretEnv(
          "TELEGRAM_WEBHOOK_SECRET_TOKEN",
          "Optional webhook secret token."
        ),
        env("TELEGRAM_BOT_USERNAME", "Bot username for mention detection."),
        urlEnv("TELEGRAM_API_BASE_URL", "Override the Telegram API base URL."),
      ],
      required: [secretEnv("TELEGRAM_BOT_TOKEN", "Telegram bot token.")],
    },
    factoryExport: "createTelegramAdapter",
    group: "official",
    name: "Telegram",
    packageName: "@chat-adapter/telegram",
    peerDeps: [],
    slug: "telegram",
    type: "platform",
  },
  twilio: {
    description:
      "Build SMS and MMS bots with Twilio Messaging webhooks and the Messages API.",
    env: {
      config: ["webhookUrl", "webhookVerifier", "statusCallbackUrl", "apiUrl"],
      credentialModes: [
        {
          label: "Account credentials",
          vars: [
            env("TWILIO_ACCOUNT_SID", "Twilio Account SID."),
            secretEnv("TWILIO_AUTH_TOKEN", "Twilio Auth Token."),
          ],
        },
      ],
      optional: [
        env("TWILIO_PHONE_NUMBER", "Default sender phone number for openDM."),
        env(
          "TWILIO_MESSAGING_SERVICE_SID",
          "Default Messaging Service SID for openDM."
        ),
      ],
    },
    factoryExport: "createTwilioAdapter",
    group: "official",
    name: "Twilio",
    packageName: "@chat-adapter/twilio",
    peerDeps: [],
    slug: "twilio",
    type: "platform",
  },
  velt: {
    description:
      "Velt Comments adapter for bots that read, reply, mention, and start threads in anchored comments across documents, rich-text editors, canvases, PDFs, and video. Includes per-comment document context and an AI streaming-reply sample app.",
    env: {
      config: [
        "botUserId",
        "botUserName",
        "webhookVersion",
        "resolveUsers",
        "selfHostingConfig",
      ],
      optional: [
        secretEnv(
          "VELT_AUTH_TOKEN",
          "Velt auth token used instead of generated bot-user tokens."
        ),
        env(
          "VELT_ORGANIZATION_ID",
          "Default organization ID for generated tokens and webhook fallback."
        ),
      ],
      required: [
        secretEnv("VELT_API_KEY", "Velt API key for REST API calls."),
        secretEnv("VELT_WEBHOOK_SECRET", "Velt webhook signing secret."),
      ],
    },
    factoryExport: "createVeltAdapter",
    group: "vendor-official",
    name: "Velt",
    packageName: "@veltdev/chat-sdk-adapter",
    peerDeps: [],
    slug: "velt",
    type: "platform",
  },
  web: {
    description:
      "Serve a browser chat UI from the same bot using the AI SDK useChat protocol \u2014 works out of the box with @ai-sdk/react and ai-elements.",
    env: {
      config: ["userName", "getUser", "persistMessageHistory", "threadIdFor"],
      notes:
        "The Web adapter delegates browser request authentication to the getUser config function.",
    },
    factoryExport: "createWebAdapter",
    group: "official",
    name: "Web",
    packageName: "@chat-adapter/web",
    peerDeps: [],
    slug: "web",
    type: "platform",
  },
  whatsapp: {
    description:
      "Connect to WhatsApp Business Cloud for customer messaging and automated conversations.",
    env: {
      optional: [
        env("WHATSAPP_BOT_USERNAME", "Bot display name."),
        urlEnv("WHATSAPP_API_URL", "Override the WhatsApp Graph API URL."),
      ],
      required: [
        secretEnv("WHATSAPP_ACCESS_TOKEN", "Meta access token."),
        secretEnv(
          "WHATSAPP_APP_SECRET",
          "App secret for webhook verification."
        ),
        env("WHATSAPP_PHONE_NUMBER_ID", "Bot phone number ID."),
        secretEnv("WHATSAPP_VERIFY_TOKEN", "Webhook verification token."),
      ],
    },
    factoryExport: "createWhatsAppAdapter",
    group: "official",
    name: "WhatsApp Business Cloud",
    packageName: "@chat-adapter/whatsapp",
    peerDeps: [],
    slug: "whatsapp",
    type: "platform",
  },
  zernio: {
    description:
      "Unified social media DM adapter covering Instagram, Facebook, Telegram, WhatsApp, X/Twitter, Bluesky, and Reddit through a single integration.",
    env: {
      optional: [
        secretEnv(
          "ZERNIO_WEBHOOK_SECRET",
          "HMAC-SHA256 secret for verifying inbound webhooks."
        ),
        urlEnv("ZERNIO_API_BASE_URL", "Override the Zernio API base URL."),
        env("ZERNIO_BOT_NAME", "Bot display name."),
      ],
      required: [secretEnv("ZERNIO_API_KEY", "Zernio API key.")],
    },
    factoryExport: "createZernioAdapter",
    group: "vendor-official",
    name: "Zernio",
    packageName: "@zernio/chat-sdk-adapter",
    peerDeps: [],
    slug: "zernio",
    type: "platform",
  },
} as const satisfies Record<string, CatalogAdapter>;

/**
 * Slug for any adapter in the catalog.
 */
export type AdapterSlug = keyof typeof ADAPTERS;

/**
 * All cataloged adapter slugs, sorted alphabetically.
 */
export const ADAPTER_NAMES = Object.keys(ADAPTERS).sort() as AdapterSlug[];

/**
 * Return every cataloged platform adapter sorted by slug.
 *
 * @returns Catalog entries whose {@link CatalogAdapter.type} is `"platform"`.
 */
export const listPlatformAdapters = (): readonly CatalogAdapter[] =>
  ADAPTER_NAMES.map((slug) => ADAPTERS[slug]).filter(
    (adapter) => adapter.type === "platform"
  );

/**
 * Return every cataloged state adapter sorted by slug.
 *
 * @returns Catalog entries whose {@link CatalogAdapter.type} is `"state"`.
 */
export const listStateAdapters = (): readonly CatalogAdapter[] =>
  ADAPTER_NAMES.map((slug) => ADAPTERS[slug]).filter(
    (adapter) => adapter.type === "state"
  );

/**
 * Check whether a string is a known adapter slug.
 *
 * @param slug - Candidate adapter slug.
 * @returns Whether the slug exists in {@link ADAPTERS}.
 *
 * @example
 * ```typescript
 * if (isAdapterSlug(input)) {
 *   const adapter = getAdapter(input);
 * }
 * ```
 */
export const isAdapterSlug = (slug: string): slug is AdapterSlug =>
  Object.hasOwn(ADAPTERS, slug);

/**
 * Look up a catalog entry by slug.
 *
 * @param slug - Adapter slug to look up.
 * @returns The catalog entry for known slugs, otherwise `undefined`.
 */
export function getAdapter(slug: AdapterSlug): CatalogAdapter;
export function getAdapter(slug: string): CatalogAdapter | undefined;
export function getAdapter(slug: string): CatalogAdapter | undefined {
  return (ADAPTERS as Record<string, CatalogAdapter>)[slug];
}

/**
 * Flatten every environment variable referenced by an adapter.
 *
 * Variables are returned in declaration order and de-duplicated by canonical
 * key. Unknown slugs return an empty array.
 *
 * @param slug - Adapter slug to inspect.
 * @returns Environment variables declared by the adapter entry.
 */
export const listEnvVars = (slug: string): readonly EnvVar[] => {
  const adapter = getAdapter(slug);
  if (!adapter) {
    return [];
  }

  const all = [
    ...(adapter.env.required ?? []),
    ...(adapter.env.credentialModes ?? []).flatMap((mode) => mode.vars),
    ...(adapter.env.optional ?? []),
  ];
  const byKey = new Map<string, EnvVar>();
  for (const envVar of all) {
    if (!byKey.has(envVar.key)) {
      byKey.set(envVar.key, envVar);
    }
  }
  return [...byKey.values()];
};

/**
 * Return only secret environment variables for an adapter.
 *
 * @param slug - Adapter slug to inspect.
 * @returns Secret variables declared by the adapter entry.
 */
export const getSecretEnvVars = (slug: string): readonly EnvVar[] =>
  listEnvVars(slug).filter((envVar) => envVar.secret);
