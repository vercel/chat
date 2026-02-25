/**
 * Discord adapter types.
 */

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
export interface DiscordAdapterConfig {
  /** Discord application ID */
  applicationId: string;
  /** Discord bot token */
  botToken: string;
  /** Role IDs that should trigger mention handlers (in addition to direct user mentions) */
  mentionRoleIds?: string[];
  /** Discord application public key for webhook signature verification */
  publicKey: string;
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

/**
 * Discord button component.
 */
export interface DiscordButton {
  custom_id?: string;
  disabled?: boolean;
  emoji?: DiscordEmoji;
  label?: string;
  style: ButtonStyle;
  type: 2; // Component type for button
  url?: string;
}

/**
 * Discord action row component.
 */
export interface DiscordActionRow {
  components: DiscordButton[];
  type: 1; // Component type for action row
}

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
  components?: DiscordActionRow[];
  content?: string;
  embeds?: APIEmbed[];
  message_reference?: {
    message_id: string;
    fail_if_not_exists?: boolean;
  };
}

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
