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
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { ConsoleLogger } from "chat";
import { recorder, withRecording } from "./recorder";

// Create a logger for adapters
const logger = new ConsoleLogger("info");

export type Adapters = {
  discord?: DiscordAdapter;
  github?: GitHubAdapter;
  linear?: LinearAdapter;
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  gchat?: GoogleChatAdapter;
};

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

/**
 * Build type-safe adapters based on available environment variables.
 * Adapters are only created if their required env vars are present.
 */
export function buildAdapters(): Adapters {
  // Start fetch recording to capture all Graph/Slack/GChat API calls
  recorder.startFetchRecording();

  const adapters: Adapters = {};

  // Discord adapter (optional)
  if (
    process.env.DISCORD_BOT_TOKEN &&
    process.env.DISCORD_PUBLIC_KEY &&
    process.env.DISCORD_APPLICATION_ID
  ) {
    // Parse comma-separated role IDs that should trigger mention handlers
    const mentionRoleIds = process.env.DISCORD_MENTION_ROLE_IDS
      ? process.env.DISCORD_MENTION_ROLE_IDS.split(",").map((id) => id.trim())
      : [];

    adapters.discord = withRecording(
      createDiscordAdapter({
        botToken: process.env.DISCORD_BOT_TOKEN,
        publicKey: process.env.DISCORD_PUBLIC_KEY,
        applicationId: process.env.DISCORD_APPLICATION_ID,
        mentionRoleIds,
        userName: "Chat SDK Bot",
        logger: logger.child("discord"),
      }),
      "discord",
      DISCORD_METHODS,
    );
  }

  // Slack adapter (optional)
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = withRecording(
      createSlackAdapter({
        botToken: process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        userName: "Chat SDK Bot",
        logger: logger.child("slack"),
      }),
      "slack",
      SLACK_METHODS,
    );
  }

  // Teams adapter (optional)
  if (process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD) {
    adapters.teams = withRecording(
      createTeamsAdapter({
        appId: process.env.TEAMS_APP_ID,
        appPassword: process.env.TEAMS_APP_PASSWORD,
        appType: "SingleTenant",
        appTenantId: process.env.TEAMS_APP_TENANT_ID as string,
        userName: "Chat SDK Demo",
        logger: logger.child("teams"),
      }),
      "teams",
      TEAMS_METHODS,
    );
  }

  // Google Chat adapter (optional)
  if (process.env.GOOGLE_CHAT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS);
      adapters.gchat = withRecording(
        createGoogleChatAdapter({
          credentials,
          userName: "Chat SDK Demo",
          // Pub/Sub topic for receiving ALL messages (not just @mentions)
          pubsubTopic: process.env.GOOGLE_CHAT_PUBSUB_TOPIC,
          // User email to impersonate for Workspace Events API (domain-wide delegation)
          impersonateUser: process.env.GOOGLE_CHAT_IMPERSONATE_USER,
          logger: logger.child("gchat"),
        }),
        "gchat",
        GCHAT_METHODS,
      );
    } catch {
      console.warn(
        "[chat] Invalid GOOGLE_CHAT_CREDENTIALS JSON, skipping gchat adapter",
      );
    }
  }

  // GitHub adapter (optional)
  // Supports both PAT auth (GITHUB_TOKEN) and GitHub App auth (GITHUB_APP_ID + GITHUB_PRIVATE_KEY)
  if (process.env.GITHUB_WEBHOOK_SECRET) {
    if (process.env.GITHUB_TOKEN) {
      // PAT authentication
      adapters.github = withRecording(
        createGitHubAdapter({
          token: process.env.GITHUB_TOKEN,
          webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
          userName: process.env.GITHUB_BOT_USERNAME || "chat-sdk-bot",
          logger: logger.child("github"),
        }),
        "github",
        GITHUB_METHODS,
      );
    } else if (process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY) {
      // GitHub App authentication (multi-tenant if no GITHUB_INSTALLATION_ID)
      adapters.github = withRecording(
        createGitHubAdapter({
          appId: process.env.GITHUB_APP_ID,
          privateKey: process.env.GITHUB_PRIVATE_KEY,
          installationId: process.env.GITHUB_INSTALLATION_ID
            ? parseInt(process.env.GITHUB_INSTALLATION_ID, 10)
            : undefined,
          webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
          userName: process.env.GITHUB_BOT_USERNAME || "chat-sdk-bot[bot]",
          logger: logger.child("github"),
        }),
        "github",
        GITHUB_METHODS,
      );
    }
  }

  // Linear adapter (optional)
  // Supports API key, OAuth app (client credentials), or pre-obtained access token
  if (process.env.LINEAR_WEBHOOK_SECRET) {
    if (process.env.LINEAR_API_KEY) {
      // API key authentication (simplest)
      adapters.linear = withRecording(
        createLinearAdapter({
          apiKey: process.env.LINEAR_API_KEY,
          webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
          userName: process.env.LINEAR_BOT_USERNAME || "chat-sdk-bot",
          logger: logger.child("linear"),
        }),
        "linear",
        LINEAR_METHODS,
      );
    } else if (
      process.env.LINEAR_CLIENT_ID &&
      process.env.LINEAR_CLIENT_SECRET
    ) {
      // OAuth app with client credentials (recommended for apps)
      adapters.linear = withRecording(
        createLinearAdapter({
          clientId: process.env.LINEAR_CLIENT_ID,
          clientSecret: process.env.LINEAR_CLIENT_SECRET,
          webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
          userName: process.env.LINEAR_BOT_USERNAME || "chat-sdk-bot",
          logger: logger.child("linear"),
        }),
        "linear",
        LINEAR_METHODS,
      );
    } else if (process.env.LINEAR_ACCESS_TOKEN) {
      // Pre-obtained OAuth access token
      adapters.linear = withRecording(
        createLinearAdapter({
          accessToken: process.env.LINEAR_ACCESS_TOKEN,
          webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
          userName: process.env.LINEAR_BOT_USERNAME || "chat-sdk-bot",
          logger: logger.child("linear"),
        }),
        "linear",
        LINEAR_METHODS,
      );
    }
  }

  return adapters;
}
