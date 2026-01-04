import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { ConsoleLogger } from "chat";
import { recorder, withRecording } from "./recorder";

// Create a logger for adapters
const logger = new ConsoleLogger("info");

export type Adapters = {
  discord?: DiscordAdapter;
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
    adapters.discord = withRecording(
      createDiscordAdapter({
        botToken: process.env.DISCORD_BOT_TOKEN,
        publicKey: process.env.DISCORD_PUBLIC_KEY,
        applicationId: process.env.DISCORD_APPLICATION_ID,
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

  return adapters;
}
