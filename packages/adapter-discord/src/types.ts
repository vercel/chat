/**
 * Discord adapter types.
 *
 * Discord payload shapes come from `discord-api-types`. Only adapter-specific
 * configuration and the Gateway forwarding envelope are declared here.
 */

import type { Logger } from "chat";
import {
  type APIApplicationCommandInteraction,
  type APIUser,
  type ChannelType,
  type ComponentType,
  type GatewayMessageCreateDispatchData,
  type GatewayMessageReactionAddDispatchData,
  type GatewayMessageReactionRemoveDispatchData,
  MessageFlags,
  type RESTPatchAPIChannelMessageJSONBody,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";

export {
  ComponentType as DiscordComponentType,
  MessageFlags as DiscordMessageFlag,
} from "discord-api-types/v10";

/**
 * Discord adapter configuration.
 */
// biome-ignore lint/style/noEnum: Public config uses an enum so callers do not pass raw string literals.
export enum DiscordContentFormat {
  ComponentsV2 = "componentsv2",
  Embeds = "embeds",
}

/**
 * Custom webhook verifier used in place of Discord's Ed25519 public key.
 *
 * Receives the incoming request and its raw body. Return a truthy value
 * to accept the request; throw or return a falsy value to reject it.
 */
export type DiscordWebhookVerifier = (
  request: Request,
  body: string
) => Promise<unknown> | unknown;

export interface DiscordAdapterConfig {
  /** Override the Discord API base URL. Defaults to DISCORD_API_URL env var or "https://discord.com/api/v10". */
  apiUrl?: string;
  /** Discord application ID or resolver. Defaults to DISCORD_APPLICATION_ID env var. */
  applicationId?: string | (() => string | Promise<string>);
  /** Discord bot token or resolver invoked per API call. Defaults to DISCORD_BOT_TOKEN env var. */
  botToken?: string | (() => string | Promise<string>);
  /** Render Discord card content as embeds or Components v2. Defaults to DiscordContentFormat.Embeds. */
  contentFormat?: DiscordContentFormat;
  /** Return interaction flags for the initial deferred slash command response. */
  interactionFlags?: (
    context: DiscordInteractionFlagsContext
  ) => DiscordInteractionResponseFlags | undefined;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Role IDs that should trigger mention handlers (in addition to direct user mentions). Defaults to DISCORD_MENTION_ROLE_IDS env var (comma-separated). */
  mentionRoleIds?: string[];
  /** Discord application public key for webhook signature verification. Defaults to DISCORD_PUBLIC_KEY env var. */
  publicKey?: string;
  /** Parent channel IDs whose non-bot messages, including messages in child threads, should trigger mention handlers without a mention. Defaults to DISCORD_RESPOND_TO_CHANNEL_IDS env var (comma-separated), or an empty array. */
  respondToChannelIds?: string[];
  /** Treat @everyone/@here pings as mentions of the bot. Defaults to false. */
  respondToGlobalMentions?: boolean;
  /** Override bot username (optional) */
  userName?: string;
  /** Custom webhook verifier used instead of Discord's Ed25519 public key. */
  webhookVerifier?: DiscordWebhookVerifier;
}

/**
 * Context passed to the Discord adapter interactionFlags callback for slash commands.
 */
export interface DiscordInteractionFlagsContext {
  /** Chat SDK channel ID where the command was invoked. */
  channelId: string;
  /** Parsed slash command name, including subcommands (e.g. "/project issue create"). */
  command: string;
  /** Raw Discord interaction payload. */
  interaction: APIApplicationCommandInteraction;
  /** Flattened slash command option text. */
  text: string;
  /** User who invoked the command. */
  user: APIUser;
}

/**
 * Discord thread ID components.
 * Used for encoding/decoding thread IDs.
 */
export interface DiscordThreadId {
  /** Channel ID */
  channelId: string;
  /** Guild ID, or "@me" for DMs */
  guildId: string;
  /** Thread ID (if message is in a thread) */
  threadId?: string;
}

/**
 * Per-request slash command context used while resolving deferred responses.
 */
export interface DiscordSlashCommandContext {
  channelId: string;
  initialResponseFlags?: DiscordMessagePayload["flags"];
  initialResponseSent: boolean;
  interactionToken: string;
}

/**
 * Async request context for Discord webhook handling.
 */
export interface DiscordRequestContext {
  slashCommand?: DiscordSlashCommandContext;
}

/**
 * Message body sent when creating or editing a message, or responding to an
 * interaction. `content: null` is only meaningful on edits.
 */
export type DiscordMessagePayload = Omit<
  RESTPostAPIChannelMessageJSONBody,
  "content"
> &
  Pick<RESTPatchAPIChannelMessageJSONBody, "content">;

export type DiscordComponentTypeValue = ComponentType;

export type DiscordMessageFlagValue = MessageFlags;

export type DiscordMessageFlags = MessageFlags;

/**
 * Flags accepted on the initial deferred interaction response.
 */
export const DiscordInteractionResponseFlag = {
  Ephemeral: MessageFlags.Ephemeral,
} as const;

export type DiscordInteractionResponseFlags =
  (typeof DiscordInteractionResponseFlag)[keyof typeof DiscordInteractionResponseFlag];

// ============================================================================
// Gateway Forwarded Events
// These types represent Gateway WebSocket events forwarded to the webhook endpoint
// ============================================================================

/**
 * Known Gateway event types that have specific handlers.
 * Other event types are still forwarded but processed generically.
 */
export type DiscordGatewayEventType =
  | "GATEWAY_MESSAGE_CREATE"
  | "GATEWAY_MESSAGE_REACTION_ADD"
  | "GATEWAY_MESSAGE_REACTION_REMOVE"
  | `GATEWAY_${string}`; // Allow any Gateway event type

/**
 * A Gateway event forwarded to the webhook endpoint.
 * All Gateway events are forwarded, even ones without specific handlers.
 */
export interface DiscordForwardedEvent {
  /** Event-specific data - structure varies by event type */
  data: DiscordGatewayMessageData | DiscordGatewayReactionData | unknown;
  /** Unix timestamp when the event was received */
  timestamp: number;
  /** Event type identifier (prefixed with GATEWAY_) */
  type: DiscordGatewayEventType;
}

/**
 * MESSAGE_CREATE dispatch data as forwarded by the Gateway listener.
 */
export type DiscordGatewayMessageData = GatewayMessageCreateDispatchData & {
  /** Set by the forwarder when it resolved the thread the message was posted in. */
  thread?: {
    id: string;
    parent_id: string;
  };
};

/**
 * MESSAGE_REACTION_ADD / MESSAGE_REACTION_REMOVE dispatch data as forwarded by
 * the Gateway listener.
 */
export type DiscordGatewayReactionData = (
  | GatewayMessageReactionAddDispatchData
  | GatewayMessageReactionRemoveDispatchData
) & {
  /** Set by the forwarder from its channel cache. Discord does not send it. */
  channel_type?: ChannelType;
  /** Set by the forwarder for DM reactions, where Discord sends no `member`. */
  user?: APIUser;
};
