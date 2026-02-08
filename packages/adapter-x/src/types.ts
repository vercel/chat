/**
 * Types for the X (Twitter) adapter.
 *
 * Webhook payloads from the Account Activity API use v1.1 format.
 * Outgoing API calls use v2 format via the @xdevplatform/xdk SDK.
 */

import type { Logger } from "chat";

// ---------------------------------------------------------------------------
// Adapter config
// ---------------------------------------------------------------------------

export interface XAdapterConfig {
  /** Consumer Key (API Key) */
  apiKey: string;
  /** Consumer Secret – used for CRC challenges and webhook signature verification */
  apiSecret: string;
  /** User access token (OAuth 1.0a) */
  accessToken: string;
  /** User access token secret (OAuth 1.0a) */
  accessTokenSecret: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Override bot username (auto-detected if not provided) */
  userName?: string;
  /** Bot user ID (auto-detected if not provided) */
  botUserId?: string;
}

// ---------------------------------------------------------------------------
// Thread ID
// ---------------------------------------------------------------------------

/** X-specific thread ID data */
export interface XThreadId {
  conversationId: string;
  type: "tweet" | "dm";
}

// ---------------------------------------------------------------------------
// V1.1 webhook payload types (Account Activity API)
// ---------------------------------------------------------------------------

/** V1.1 user object embedded in webhook events */
export interface V1User {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
  location?: string;
  description?: string;
  protected?: boolean;
  verified?: boolean;
  followers_count?: number;
  friends_count?: number;
  statuses_count?: number;
  profile_image_url_https?: string;
}

/** V1.1 entity ranges */
export interface V1Entities {
  hashtags?: Array<{
    text: string;
    indices: [number, number];
  }>;
  urls?: Array<{
    url: string;
    expanded_url: string;
    display_url: string;
    indices: [number, number];
  }>;
  user_mentions?: Array<{
    id: number;
    id_str: string;
    name: string;
    screen_name: string;
    indices: [number, number];
  }>;
  symbols?: Array<{
    text: string;
    indices: [number, number];
  }>;
  media?: Array<{
    id: number;
    id_str: string;
    url: string;
    media_url_https: string;
    type: string;
    indices: [number, number];
    sizes?: Record<string, { w: number; h: number; resize: string }>;
  }>;
}

/** Extended tweet for longform posts */
export interface V1ExtendedTweet {
  full_text: string;
  display_text_range: [number, number];
  entities: V1Entities;
}

/** V1.1 tweet object from webhook payloads */
export interface V1Tweet {
  created_at: string;
  id: number;
  id_str: string;
  text: string;
  truncated?: boolean;
  user: V1User;
  in_reply_to_status_id?: number | null;
  in_reply_to_status_id_str?: string | null;
  in_reply_to_user_id?: number | null;
  in_reply_to_user_id_str?: string | null;
  in_reply_to_screen_name?: string | null;
  entities: V1Entities;
  extended_tweet?: V1ExtendedTweet;
  is_quote_status?: boolean;
  retweet_count?: number;
  favorite_count?: number;
  favorited?: boolean;
  retweeted?: boolean;
  lang?: string;
  retweeted_status?: V1Tweet;
}

/** V1.1 direct message event */
export interface V1DirectMessageEvent {
  type: "message_create";
  id: string;
  created_timestamp: string;
  message_create: {
    target: {
      recipient_id: string;
    };
    sender_id: string;
    source_app_id?: string;
    message_data: {
      text: string;
      entities?: V1Entities;
    };
  };
}

/** V1.1 favorite event */
export interface V1FavoriteEvent {
  id: string;
  created_at: string;
  timestamp_ms: number;
  favorited_status: V1Tweet;
  user: V1User;
}

// ---------------------------------------------------------------------------
// Webhook envelope
// ---------------------------------------------------------------------------

/** Top-level webhook payload from Account Activity API */
export interface XWebhookPayload {
  for_user_id: string;
  user_has_blocked?: string;
  tweet_create_events?: V1Tweet[];
  favorite_events?: V1FavoriteEvent[];
  tweet_delete_events?: Array<{
    status: { id: string; user_id: string };
    timestamp_ms: string;
  }>;
  direct_message_events?: V1DirectMessageEvent[];
  direct_message_indicate_typing_events?: Array<{
    created_timestamp: string;
    sender_id: string;
    target: { recipient_id: string };
  }>;
  follow_events?: Array<{
    type: "follow" | "unfollow";
    created_timestamp: string;
    target: V1User;
    source: V1User;
  }>;
  block_events?: Array<{
    type: "block" | "unblock";
    created_timestamp: string;
    target: V1User;
    source: V1User;
  }>;
  /** Users lookup table (keyed by user ID string) */
  users?: Record<string, V1User>;
}
