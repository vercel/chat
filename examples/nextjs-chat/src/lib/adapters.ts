import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { createXAdapter, type XAdapter } from "@chat-adapter/x";
import { ConsoleLogger } from "chat";
import { recorder, withRecording } from "./recorder";

// Create a logger for adapters
const logger = new ConsoleLogger("info");

export type Adapters = {
  discord?: DiscordAdapter;
  github?: GitHubAdapter;
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  gchat?: GoogleChatAdapter;
  x?: XAdapter;
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
const X_METHODS = [
  "postMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "fetchMessages",
  "openDM",
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

  // X adapter (optional)
  if (process.env.X_API_KEY && process.env.X_API_SECRET) {
    adapters.x = withRecording(
      createXAdapter({
        apiKey: process.env.X_API_KEY,
        apiSecret: process.env.X_API_SECRET,
        accessToken: process.env.X_ACCESS_TOKEN as string,
        accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET as string,
        userName: "Chat SDK Bot",
        logger: logger.child("x"),
      }),
      "x",
      X_METHODS,
    );
  }

  return adapters;
}
