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
  /** Discord bot token */
  botToken: string;
  /** Discord application public key for webhook signature verification */
  publicKey: string;
  /** Discord application ID */
  applicationId: string;
  /** Role IDs that should trigger mention handlers (in addition to direct user mentions) */
  mentionRoleIds?: string[];
}

/**
 * Discord thread ID components.
 * Used for encoding/decoding thread IDs.
 */
export interface DiscordThreadId {
  /** Guild ID, or "@me" for DMs */
  guildId: string;
  /** Channel ID */
  channelId: string;
  /** Thread ID (if message is in a thread) */
  threadId?: string;
}

/**
 * Incoming Discord interaction from webhook.
 */
export interface DiscordInteraction {
  id: string;
  type: InteractionType;
  application_id: string;
  token: string;
  version: number;
  guild_id?: string;
  channel_id?: string;
  channel?: {
    id: string;
    type: ChannelType;
    name?: string;
    /** Parent channel ID (present when channel is a thread) */
    parent_id?: string;
  };
  member?: {
    user: DiscordUser;
    nick?: string;
    roles: string[];
    joined_at: string;
  };
  user?: DiscordUser;
  message?: APIMessage;
  data?: DiscordInteractionData;
}

/**
 * Discord user object.
 */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
  bot?: boolean;
}

/**
 * Discord interaction data (for components/commands).
 */
export interface DiscordInteractionData {
  custom_id?: string;
  component_type?: number;
  values?: string[];
  name?: string;
  type?: number;
  options?: DiscordCommandOption[];
}

/**
 * Discord command option.
 */
export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
}

/**
 * Discord emoji.
 */
export interface DiscordEmoji {
  id?: string;
  name: string;
  animated?: boolean;
}

/**
 * Discord button component.
 */
export interface DiscordButton {
  type: 2; // Component type for button
  style: ButtonStyle;
  label?: string;
  emoji?: DiscordEmoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

/**
 * Discord action row component.
 */
export interface DiscordActionRow {
  type: 1; // Component type for action row
  components: DiscordButton[];
}

/**
 * Discord message create payload.
 */
export interface DiscordMessagePayload {
  content?: string;
  embeds?: APIEmbed[];
  components?: DiscordActionRow[];
  allowed_mentions?: {
    parse?: ("roles" | "users" | "everyone")[];
    roles?: string[];
    users?: string[];
    replied_user?: boolean;
  };
  message_reference?: {
    message_id: string;
    fail_if_not_exists?: boolean;
  };
  attachments?: {
    id: string;
    filename: string;
    description?: string;
  }[];
}

/**
 * Discord interaction response types.
 * Note: Only the types currently used are defined here.
 * Additional types: ChannelMessageWithSource (4), UpdateMessage (7)
 */
export enum InteractionResponseType {
  /** ACK and edit later (deferred) */
  DeferredChannelMessageWithSource = 5,
  /** ACK component interaction, update message later */
  DeferredUpdateMessage = 6,
}

/**
 * Discord interaction response.
 */
export interface DiscordInteractionResponse {
  type: InteractionResponseType;
  data?: DiscordMessagePayload;
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
  /** Event type identifier (prefixed with GATEWAY_) */
  type: DiscordGatewayEventType;
  /** Unix timestamp when the event was received */
  timestamp: number;
  /** Event-specific data - structure varies by event type */
  data: DiscordGatewayMessageData | DiscordGatewayReactionData | unknown;
}

/**
 * Message data from a MESSAGE_CREATE Gateway event.
 */
export interface DiscordGatewayMessageData {
  /** Message ID */
  id: string;
  /** Channel where the message was sent */
  channel_id: string;
  /** Channel type (11 = public thread, 12 = private thread) */
  channel_type?: number;
  /** Guild ID, or null for DMs */
  guild_id: string | null;
  /** Message content */
  content: string;
  /** Message author */
  author: {
    id: string;
    username: string;
    global_name?: string;
    bot: boolean;
  };
  /** ISO timestamp */
  timestamp: string;
  /** Users mentioned in the message */
  mentions: Array<{ id: string; username: string }>;
  /** Role IDs mentioned in the message */
  mention_roles?: string[];
  /** File attachments */
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    content_type?: string;
    size: number;
  }>;
  /** Thread info if message is in a thread */
  thread?: {
    id: string;
    parent_id: string;
  };
  /** Whether the bot was mentioned */
  is_mention?: boolean;
}

/**
 * Reaction data from REACTION_ADD or REACTION_REMOVE Gateway events.
 */
export interface DiscordGatewayReactionData {
  /** Emoji used for the reaction */
  emoji: {
    name: string | null;
    id: string | null;
  };
  /** ID of the message that was reacted to */
  message_id: string;
  /** Channel containing the message */
  channel_id: string;
  /** Guild ID, or null for DMs */
  guild_id: string | null;
  /** User who added/removed the reaction */
  user_id: string;
  /** User details (for DMs) */
  user?: {
    id: string;
    username: string;
    bot?: boolean;
  };
  /** Member details (for guild reactions) */
  member?: {
    user: {
      id: string;
      username: string;
      global_name?: string;
      bot?: boolean;
    };
  };
}
