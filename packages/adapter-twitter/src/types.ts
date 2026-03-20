/**
 * Twitter / X adapter types.
 */

import type { Logger } from "chat";

/**
 * Twitter adapter configuration.
 */
export interface TwitterAdapterConfig {
  /**
   * Twitter API v2 Bearer Token for read-only endpoints.
   * Defaults to TWITTER_BEARER_TOKEN env var.
   */
  bearerToken?: string;

  /**
   * Twitter API consumer key (API Key).
   * Used for OAuth 1.0a signing and CRC validation.
   * Defaults to TWITTER_CONSUMER_KEY env var.
   */
  consumerKey?: string;

  /**
   * Twitter API consumer secret (API Secret).
   * Used for CRC HMAC-SHA256 computation.
   * Defaults to TWITTER_CONSUMER_SECRET env var.
   */
  consumerSecret?: string;

  /**
   * OAuth 1.0a access token for the bot account.
   * Defaults to TWITTER_ACCESS_TOKEN env var.
   */
  accessToken?: string;

  /**
   * OAuth 1.0a access token secret for the bot account.
   * Defaults to TWITTER_ACCESS_TOKEN_SECRET env var.
   */
  accessTokenSecret?: string;

  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;

  /** Override bot username (optional). Defaults to TWITTER_BOT_USERNAME env var. */
  userName?: string;

  /**
   * Optional custom API base URL (defaults to https://api.twitter.com).
   * Useful for testing with a mock server.
   */
  apiBaseUrl?: string;

  /**
   * Optional webhook environment name for Account Activity API.
   * Defaults to TWITTER_WEBHOOK_ENV env var or "production".
   */
  webhookEnvironment?: string;
}

/**
 * Twitter thread ID components.
 * A "thread" in Twitter maps to a DM conversation.
 */
export interface TwitterThreadId {
  /** DM conversation ID */
  conversationId: string;
}

/**
 * Twitter user object from the Account Activity API webhook payload.
 */
export interface TwitterUser {
  id: string;
  created_timestamp: string;
  name: string;
  screen_name: string;
  location?: string;
  description?: string;
  url?: string;
  protected: boolean;
  verified: boolean;
  followers_count: number;
  friends_count: number;
  statuses_count: number;
  profile_image_url_https?: string;
}

/**
 * Twitter DM event message data.
 */
export interface TwitterMessageData {
  text: string;
  entities?: {
    hashtags: TwitterEntity[];
    symbols: TwitterEntity[];
    user_mentions: TwitterMentionEntity[];
    urls: TwitterUrlEntity[];
  };
  attachment?: {
    type: string;
    media: TwitterMedia;
  };
}

export interface TwitterEntity {
  text?: string;
  indices: [number, number];
}

export interface TwitterMentionEntity extends TwitterEntity {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
}

export interface TwitterUrlEntity extends TwitterEntity {
  url: string;
  expanded_url: string;
  display_url: string;
}

export interface TwitterMedia {
  id: number;
  id_str: string;
  media_url: string;
  media_url_https: string;
  type: string;
  sizes?: Record<
    string,
    {
      w: number;
      h: number;
      resize: string;
    }
  >;
}

/**
 * A single DM event within the Account Activity webhook payload.
 */
export interface TwitterDirectMessageEvent {
  type: "message_create";
  id: string;
  created_timestamp: string;
  message_create: {
    target: {
      recipient_id: string;
    };
    sender_id: string;
    source_app_id?: string;
    message_data: TwitterMessageData;
  };
}

/**
 * Account Activity API webhook payload for DM events.
 */
export interface TwitterDMWebhookPayload {
  for_user_id: string;
  direct_message_events: TwitterDirectMessageEvent[];
  users?: Record<string, TwitterUser>;
  apps?: Record<string, { id: string; name: string; url: string }>;
}

/**
 * Twitter API v2 DM event from GET /2/direct_messages/events.
 */
export interface TwitterDMEventV2 {
  id: string;
  event_type: "MessageCreate" | "ParticipantsJoin" | "ParticipantsLeave";
  text: string;
  dm_conversation_id?: string;
  created_at?: string;
  sender_id?: string;
  participant_ids?: string[];
  attachments?: {
    media_keys?: string[];
  };
  referenced_tweets?: Array<{
    id: string;
    type: string;
  }>;
}

/**
 * Response envelope for Twitter API v2 DM send.
 */
export interface TwitterDMSendResponse {
  dm_conversation_id: string;
  dm_event_id: string;
}

/**
 * Response envelope for Twitter API v2 endpoints.
 */
export interface TwitterApiV2Response<TData> {
  data?: TData;
  errors?: TwitterApiError[];
  includes?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/**
 * Twitter API error object.
 */
export interface TwitterApiError {
  message: string;
  code?: number;
  title?: string;
  detail?: string;
  type?: string;
  status?: number;
}

/**
 * Twitter API v2 user object.
 */
export interface TwitterUserV2 {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  verified?: boolean;
}

/**
 * Full webhook payload from Account Activity API.
 * Can contain DM events, tweet events, follow events, etc.
 * We focus on DM events for the adapter.
 */
export interface TwitterAccountActivityPayload {
  for_user_id: string;
  direct_message_events?: TwitterDirectMessageEvent[];
  users?: Record<string, TwitterUser>;
  apps?: Record<string, { id: string; name: string; url: string }>;
  // Other activity types we acknowledge but don't process:
  tweet_create_events?: unknown[];
  favorite_events?: unknown[];
  follow_events?: unknown[];
  block_events?: unknown[];
  mute_events?: unknown[];
}

/**
 * Raw message type for the Twitter adapter.
 * This is the DM event as received from the webhook.
 */
export type TwitterRawMessage = TwitterDirectMessageEvent;
