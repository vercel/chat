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

// Create a shared logger for adapters that need explicit logger overrides
const logger = new ConsoleLogger("info");

export interface Adapters {
  discord?: DiscordAdapter;
  gchat?: GoogleChatAdapter;
  github?: GitHubAdapter;
  linear?: LinearAdapter;
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
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
 *
 * Factory functions auto-detect env vars, so only app-specific overrides
 * (like userName and appType) need to be provided explicitly.
 */
export function buildAdapters(): Adapters {
  // Start fetch recording to capture all Graph/Slack/GChat API calls
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

  // Slack adapter (optional) - env vars: SLACK_SIGNING_SECRET + (SLACK_BOT_TOKEN or SLACK_CLIENT_ID/SECRET)
  if (process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = withRecording(
      createSlackAdapter({
        userName: "Chat SDK Bot",
        logger: logger.child("slack"),
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

  // GitHub adapter (optional) - env vars: GITHUB_WEBHOOK_SECRET + (GITHUB_TOKEN or GITHUB_APP_ID/PRIVATE_KEY)
  if (process.env.GITHUB_WEBHOOK_SECRET) {
    try {
      adapters.github = withRecording(
        createGitHubAdapter({
          logger: logger.child("github"),
        }),
        "github",
        GITHUB_METHODS
      );
    } catch {
      console.warn(
        "[chat] Failed to create github adapter (check GITHUB_TOKEN or GITHUB_APP_ID/PRIVATE_KEY)"
      );
    }
  }

  // Linear adapter (optional) - env vars: LINEAR_WEBHOOK_SECRET + (LINEAR_API_KEY or LINEAR_CLIENT_ID/SECRET)
  if (process.env.LINEAR_WEBHOOK_SECRET) {
    try {
      adapters.linear = withRecording(
        createLinearAdapter({
          logger: logger.child("linear"),
        }),
        "linear",
        LINEAR_METHODS
      );
    } catch {
      console.warn(
        "[chat] Failed to create linear adapter (check LINEAR_API_KEY or LINEAR_CLIENT_ID/SECRET)"
      );
    }
  }

  return adapters;
}
