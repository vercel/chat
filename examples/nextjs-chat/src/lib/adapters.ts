import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
import { createLinearAdapter, type LinearAdapter } from "@chat-adapter/linear";
import {
  createMessengerAdapter,
  type MessengerAdapter,
} from "@chat-adapter/messenger";
import {
  createSlackAdapter,
  type SlackAdapter,
  type SlackAdapterConfig,
} from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import {
  createTelegramAdapter,
  type TelegramAdapter,
} from "@chat-adapter/telegram";
import { createWebAdapter, type WebAdapter } from "@chat-adapter/web";
import {
  createWhatsAppAdapter,
  type WhatsAppAdapter,
} from "@chat-adapter/whatsapp";
import {
  connectGitHubAdapter,
  connectLinearAdapter,
  connectSlackAdapter,
} from "@vercel/connect/chat";
import { ConsoleLogger } from "chat";
import { recorder, withRecording } from "./recorder";

// Create a shared logger for adapters that need explicit logger overrides
const logger = new ConsoleLogger("info");

export interface Adapters {
  discord?: DiscordAdapter;
  gchat?: GoogleChatAdapter;
  github?: GitHubAdapter;
  linear?: LinearAdapter;
  messenger?: MessengerAdapter;
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  telegram?: TelegramAdapter;
  web?: WebAdapter;
  whatsapp?: WhatsAppAdapter;
}

// Methods to record for each adapter (outgoing API calls)
const DISCORD_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
// Slack agent experience (optional) — requires the Agents feature and the
// assistant:write scope plus the matching events in slack-manifest.yml.
// Suggested prompts are pinned automatically when an assistant/agent thread
// opens; the resolver tailors them to the user's active view (agent_view
// folds what the user is looking at into the event as `entities`).
// `loadingMessages` rotate in the thinking indicator while the bot works.
// Set SLACK_AGENT_VIEW=true when your manifest uses `agent_view`.
// Set SLACK_NATIVE_STREAMING=false to compare Slack's native streaming API
// (chat.startStream/appendStream/stopStream, the default) against the
// post-and-edit fallback (chat.update deltas).
const SLACK_AGENT_OPTIONS: Pick<
  SlackAdapterConfig,
  | "agentView"
  | "feedbackButtons"
  | "loadingMessages"
  | "nativeStreaming"
  | "suggestedPrompts"
> = {
  agentView: process.env.SLACK_AGENT_VIEW === "true",
  // Thumbs up/down on every streamed reply; clicks dispatch to
  // bot.onAction("ai_feedback") — see bot.tsx.
  feedbackButtons: { actionId: "ai_feedback" },
  nativeStreaming: process.env.SLACK_NATIVE_STREAMING !== "false",
  loadingMessages: [
    "Thinking...",
    "Consulting the Chat SDK docs...",
    "Almost there...",
  ],
  suggestedPrompts: ({ entities }) => ({
    title: "Welcome! What can I do for you?",
    prompts: [
      entities?.some((entity) => entity.kind === "channel")
        ? {
            title: "Summarize this channel",
            message: "Summarize the channel I'm currently viewing",
          }
        : {
            title: "Catch me up",
            message: "What can you help me with?",
          },
      { title: "Draft a message", message: "Help me draft a message" },
      { title: "Explain Chat SDK", message: "What is the Chat SDK?" },
    ],
  }),
};

const SLACK_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "stream",
  "openDM",
  "fetchMessages",
];
const TEAMS_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const GCHAT_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "openDM",
  "fetchMessages",
];
const GITHUB_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "fetchMessages",
];
const LINEAR_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "fetchMessages",
];
const MESSENGER_METHODS = [
  "postMessage",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const TELEGRAM_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const WHATSAPP_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];

/**
 * Build type-safe adapters based on available environment variables.
 * Adapters are only created if their required env vars are present.
 *
 * Factory functions auto-detect env vars, so only app-specific overrides
 * (like userName and appType) need to be provided explicitly.
 */
export function buildAdapters(): Adapters {
  // Start fetch recording to capture outgoing adapter API calls
  recorder.startFetchRecording();

  const adapters: Adapters = {};

  // Discord adapter (optional) - env vars: DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID
  if (process.env.DISCORD_BOT_TOKEN) {
    adapters.discord = withRecording(
      createDiscordAdapter({
        userName: "Chat SDK Bot",
        logger: logger.child("discord"),
      }),
      "discord",
      DISCORD_METHODS
    );
  }

  // Messenger adapter (optional) - env vars: FACEBOOK_APP_SECRET, FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_VERIFY_TOKEN
  if (
    process.env.FACEBOOK_APP_SECRET &&
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN &&
    process.env.FACEBOOK_VERIFY_TOKEN
  ) {
    try {
      adapters.messenger = withRecording(
        createMessengerAdapter({
          userName: "Chat SDK Bot",
          logger: logger.child("messenger"),
        }),
        "messenger",
        MESSENGER_METHODS
      );
    } catch (err) {
      console.warn(
        "[chat] Failed to create messenger adapter:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Slack adapter (optional) - Vercel Connect.
  // env vars: SLACK_CONNECTOR (the connector UID, e.g. "slack/acme-slack") plus
  // VERCEL_OIDC_TOKEN (run `vercel env pull`). connectSlackAdapter() resolves a
  // short-lived bot token from Vercel Connect at runtime and verifies
  // Connect-forwarded webhooks via the Vercel OIDC token, so there's no
  // SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET to store.
  if (process.env.SLACK_CONNECTOR) {
    adapters.slack = withRecording(
      createSlackAdapter({
        userName: "Chat SDK Bot",
        logger: logger.child("slack"),
        ...SLACK_AGENT_OPTIONS,
        ...connectSlackAdapter(process.env.SLACK_CONNECTOR),
      }),
      "slack",
      SLACK_METHODS
    );
  } else if (process.env.SLACK_BOT_TOKEN) {
    // Slack adapter (optional) - plain bot token.
    // env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET (auto-detected by the
    // factory since only non-auth fields are passed here).
    adapters.slack = withRecording(
      createSlackAdapter({
        userName: "Chat SDK Bot",
        logger: logger.child("slack"),
        ...SLACK_AGENT_OPTIONS,
      }),
      "slack",
      SLACK_METHODS
    );
  }

  // Teams adapter (optional) - env vars: TEAMS_APP_ID, TEAMS_APP_PASSWORD
  if (process.env.TEAMS_APP_ID) {
    adapters.teams = withRecording(
      createTeamsAdapter({
        appType: "SingleTenant",
        userName: "Chat SDK Demo",
        logger: logger.child("teams"),
      }),
      "teams",
      TEAMS_METHODS
    );
  }

  // Google Chat adapter (optional) - env vars: GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC
  if (
    process.env.GOOGLE_CHAT_CREDENTIALS ||
    process.env.GOOGLE_CHAT_USE_ADC === "true"
  ) {
    try {
      adapters.gchat = withRecording(
        createGoogleChatAdapter({
          userName: "Chat SDK Demo",
          logger: logger.child("gchat"),
        }),
        "gchat",
        GCHAT_METHODS
      );
    } catch {
      console.warn(
        "[chat] Failed to create gchat adapter (check GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC)"
      );
    }
  }

  // GitHub adapter (optional) - Vercel Connect.
  // env vars: GITHUB_CONNECTOR (the connector UID, e.g. "github/acme-github")
  // plus VERCEL_OIDC_TOKEN (run `vercel env pull`). connectGitHubAdapter()
  // resolves a short-lived installation token from Vercel Connect at runtime
  // (skipping the GitHub App JWT exchange) and verifies Connect-forwarded
  // webhooks via the Vercel OIDC token instead of a webhook secret.
  if (process.env.GITHUB_CONNECTOR) {
    try {
      adapters.github = withRecording(
        createGitHubAdapter({
          logger: logger.child("github"),
          userName: "chat-sdk-bot",
          // In Connect mode the adapter can't auto-detect its own bot user id
          // (the /app lookup needs an App JWT), so set GITHUB_BOT_USER_ID — the
          // adapter auto-detects it — to skip self-authored comments and avoid
          // reply loops across function instances.
          ...connectGitHubAdapter(process.env.GITHUB_CONNECTOR),
        }),
        "github",
        GITHUB_METHODS
      );
    } catch {
      console.warn(
        "[chat] Failed to create github adapter (check GITHUB_CONNECTOR and VERCEL_OIDC_TOKEN)"
      );
    }
  }

  // Linear adapter (optional) - Vercel Connect.
  // env vars: LINEAR_CONNECTOR (the connector UID, e.g. "linear/acme-linear")
  // plus VERCEL_OIDC_TOKEN (run `vercel env pull`). connectLinearAdapter()
  // resolves a short-lived access token from Vercel Connect at runtime and
  // verifies Connect-forwarded webhooks via the Vercel OIDC token instead of a
  // webhook secret. Set LINEAR_MODE=agent-sessions for app-actor installs.
  if (process.env.LINEAR_CONNECTOR) {
    try {
      adapters.linear = withRecording(
        createLinearAdapter({
          logger: logger.child("linear"),
          mode:
            process.env.LINEAR_MODE === "agent-sessions"
              ? "agent-sessions"
              : "comments",
          ...connectLinearAdapter(process.env.LINEAR_CONNECTOR),
        }),
        "linear",
        LINEAR_METHODS
      );
    } catch {
      console.warn(
        "[chat] Failed to create linear adapter (check LINEAR_CONNECTOR and VERCEL_OIDC_TOKEN)"
      );
    }
  }

  // Telegram adapter (optional) - env vars: TELEGRAM_BOT_TOKEN
  if (process.env.TELEGRAM_BOT_TOKEN) {
    adapters.telegram = withRecording(
      createTelegramAdapter({
        logger: logger.child("telegram"),
      }),
      "telegram",
      TELEGRAM_METHODS
    );
  }

  // WhatsApp adapter (optional) - env vars: WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN
  console.log("[chat] WhatsApp env check:", {
    hasAccessToken: !!process.env.WHATSAPP_ACCESS_TOKEN,
    hasAppSecret: !!process.env.WHATSAPP_APP_SECRET,
    hasPhoneNumberId: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    hasVerifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN,
  });
  if (
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    try {
      adapters.whatsapp = withRecording(
        createWhatsAppAdapter({
          logger: logger.child("whatsapp"),
        }),
        "whatsapp",
        WHATSAPP_METHODS
      );
    } catch (err) {
      console.warn(
        "[chat] Failed to create whatsapp adapter:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Web adapter — always available, no env vars required.
  // Demo uses a fixed user id; replace `getUser` with your real auth
  // (NextAuth, Clerk, signed cookie, etc.) in production.
  adapters.web = createWebAdapter({
    userName: "Chat SDK Bot",
    logger: logger.child("web"),
    getUser: () => ({ id: "demo", name: "Demo User" }),
  });

  return adapters;
}
