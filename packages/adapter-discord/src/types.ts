/**
 * Discord adapter types.
 */

import type { Logger } from "chat";
import type {
  APIEmbed,
  APIMessage,
  ButtonStyle,
  ChannelType,
  InteractionType,
} from "discord-api-types/v10";

/**
 * Discord adapter configuration.
 */
// biome-ignore lint/style/noEnum: Public config uses an enum so callers do not pass raw string literals.
export enum DiscordContentFormat {
  ComponentsV2 = "componentsv2",
  Embeds = "embeds",
}

export interface DiscordAdapterConfig {
  /** Override the Discord API base URL. Defaults to DISCORD_API_URL env var or "https://discord.com/api/v10". */
  apiUrl?: string;
  /** Discord application ID. Defaults to DISCORD_APPLICATION_ID env var. */
  applicationId?: string;
  /** Discord bot token. Defaults to DISCORD_BOT_TOKEN env var. */
  botToken?: string;
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
  interaction: DiscordInteraction;
  /** Flattened slash command option text. */
  text: string;
  /** User who invoked the command. */
  user: DiscordUser;
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
 * Incoming Discord interaction from webhook.
 */
export interface DiscordInteraction {
  application_id: string;
  channel?: {
    id: string;
    type: ChannelType;
    name?: string;
    /** Parent channel ID (present when channel is a thread) */
    parent_id?: string;
  };
  channel_id?: string;
  data?: DiscordInteractionData;
  guild_id?: string;
  id: string;
  member?: {
    user: DiscordUser;
    nick?: string;
    roles: string[];
    joined_at: string;
  };
  message?: APIMessage;
  token: string;
  type: InteractionType;
  user?: DiscordUser;
  version: number;
}

/**
 * Discord user object.
 */
export interface DiscordUser {
  avatar?: string;
  bot?: boolean;
  discriminator: string;
  global_name?: string;
  id: string;
  username: string;
}

/**
 * Discord interaction data (for components/commands).
 */
export interface DiscordInteractionData {
  component_type?: number;
  custom_id?: string;
  name?: string;
  options?: DiscordCommandOption[];
  type?: number;
  values?: string[];
}

/**
 * Discord command option.
 */
export interface DiscordCommandOption {
  name: string;
  options?: DiscordCommandOption[];
  type: number;
  value?: string | number | boolean;
}

/**
 * Discord emoji.
 */
export interface DiscordEmoji {
  animated?: boolean;
  id?: string;
  name: string;
}

export const DiscordComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17,
} as const;

export type DiscordComponentTypeValue =
  (typeof DiscordComponentType)[keyof typeof DiscordComponentType];

/**
 * Discord button component.
 */
export interface DiscordButton {
  custom_id?: string;
  disabled?: boolean;
  emoji?: DiscordEmoji;
  label?: string;
  style: ButtonStyle;
  type: typeof DiscordComponentType.Button;
  url?: string;
}

/**
 * Discord string select component.
 */
export interface DiscordStringSelect {
  custom_id: string;
  disabled?: boolean;
  max_values?: number;
  min_values?: number;
  options: {
    default?: boolean;
    description?: string;
    emoji?: DiscordEmoji;
    label: string;
    value: string;
  }[];
  placeholder?: string;
  type: typeof DiscordComponentType.StringSelect;
}

export type DiscordActionRowComponent = DiscordButton | DiscordStringSelect;

/**
 * Discord action row component.
 */
export interface DiscordActionRow {
  components: DiscordActionRowComponent[];
  type: typeof DiscordComponentType.ActionRow;
}

export interface DiscordTextDisplay {
  content: string;
  type: typeof DiscordComponentType.TextDisplay;
}

export interface DiscordThumbnail {
  description?: string;
  media: {
    url: string;
  };
  spoiler?: boolean;
  type: typeof DiscordComponentType.Thumbnail;
}

export interface DiscordMediaGallery {
  items: {
    description?: string;
    media: {
      url: string;
    };
    spoiler?: boolean;
  }[];
  type: typeof DiscordComponentType.MediaGallery;
}

export interface DiscordFileComponent {
  file: {
    url: string;
  };
  spoiler?: boolean;
  type: typeof DiscordComponentType.File;
}

export interface DiscordSeparator {
  divider?: boolean;
  spacing?: 1 | 2;
  type: typeof DiscordComponentType.Separator;
}

export interface DiscordSection {
  accessory: DiscordButton | DiscordThumbnail;
  components: DiscordTextDisplay[];
  type: typeof DiscordComponentType.Section;
}

export type DiscordContainerChild =
  | DiscordActionRow
  | DiscordFileComponent
  | DiscordMediaGallery
  | DiscordSection
  | DiscordSeparator
  | DiscordTextDisplay;

export interface DiscordContainer {
  accent_color?: number;
  components: DiscordContainerChild[];
  spoiler?: boolean;
  type: typeof DiscordComponentType.Container;
}

export type DiscordMessageComponent =
  | DiscordActionRow
  | DiscordContainer
  | DiscordFileComponent
  | DiscordMediaGallery
  | DiscordSection
  | DiscordSeparator
  | DiscordTextDisplay;

/**
 * Discord message create payload.
 */
export interface DiscordMessagePayload {
  allowed_mentions?: {
    parse?: ("roles" | "users" | "everyone")[];
    roles?: string[];
    users?: string[];
    replied_user?: boolean;
  };
  attachments?: {
    id: string;
    filename: string;
    description?: string;
  }[];
  components?: DiscordMessageComponent[];
  content?: string | null;
  embeds?: APIEmbed[];
  flags?: number;
  message_reference?: {
    message_id: string;
    fail_if_not_exists?: boolean;
  };
}

export const DiscordMessageFlag = {
  Crossposted: 1,
  IsCrosspost: 2,
  SuppressEmbeds: 4,
  SourceMessageDeleted: 8,
  Urgent: 16,
  HasThread: 32,
  Ephemeral: 64,
  Loading: 128,
  FailedToMentionSomeRolesInThread: 256,
  SuppressNotifications: 4096,
  IsVoiceMessage: 8192,
  HasSnapshot: 16_384,
  IsComponentsV2: 32_768,
} as const;

export type DiscordMessageFlagValue =
  (typeof DiscordMessageFlag)[keyof typeof DiscordMessageFlag];

export type DiscordMessageFlags = DiscordMessageFlagValue;

export const DiscordInteractionResponseFlag = {
  Ephemeral: 64,
} as const;

export type DiscordInteractionResponseFlags =
  (typeof DiscordInteractionResponseFlag)[keyof typeof DiscordInteractionResponseFlag];

/**
 * Discord interaction response types.
 * Note: Only the types currently used are defined here.
 * Additional types: ChannelMessageWithSource (4), UpdateMessage (7)
 */
export const InteractionResponseType = {
  /** ACK and edit later (deferred) */
  DeferredChannelMessageWithSource: 5,
  /** ACK component interaction, update message later */
  DeferredUpdateMessage: 6,
} as const;

export type InteractionResponseType =
  (typeof InteractionResponseType)[keyof typeof InteractionResponseType];

/**
 * Discord interaction response.
 */
export interface DiscordInteractionResponse {
  data?: DiscordMessagePayload;
  type: InteractionResponseType;
}

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
 * Message data from a MESSAGE_CREATE Gateway event.
 */
export interface DiscordGatewayMessageData {
  /** File attachments */
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    content_type?: string;
    size: number;
  }>;
  /** Message author */
  author: {
    id: string;
    username: string;
    global_name?: string;
    bot: boolean;
  };
  /** Channel where the message was sent */
  channel_id: string;
  /** Channel type (11 = public thread, 12 = private thread) */
  channel_type?: number;
  /** Message content */
  content: string;
  /** Guild ID, or null for DMs */
  guild_id: string | null;
  /** Message ID */
  id: string;
  /** Whether the bot was mentioned */
  is_mention?: boolean;
  /** Whether the message pings @everyone or @here */
  mention_everyone?: boolean;
  /** Role IDs mentioned in the message */
  mention_roles?: string[];
  /** Users mentioned in the message */
  mentions: Array<{ id: string; username: string }>;
  /** Thread info if message is in a thread */
  thread?: {
    id: string;
    parent_id: string;
  };
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Reaction data from REACTION_ADD or REACTION_REMOVE Gateway events.
 */
export interface DiscordGatewayReactionData {
  /** Channel containing the message */
  channel_id: string;
  /** Channel type (11 = public thread, 12 = private thread) */
  channel_type?: number;
  /** Emoji used for the reaction */
  emoji: {
    name: string | null;
    id: string | null;
  };
  /** Guild ID, or null for DMs */
  guild_id: string | null;
  /** Member details (for guild reactions) */
  member?: {
    user: {
      id: string;
      username: string;
      global_name?: string;
      bot?: boolean;
    };
  };
  /** ID of the message that was reacted to */
  message_id: string;
  /** User details (for DMs) */
  user?: {
    id: string;
    username: string;
    bot?: boolean;
  };
  /** User who added/removed the reaction */
  user_id: string;
}
