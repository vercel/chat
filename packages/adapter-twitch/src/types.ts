import type { EncryptedTokenData } from "@chat-adapter/shared";
import type { Logger } from "chat";

/**
 * User access token for the bot account, or an async provider that returns
 * one. Only whispers need a user token; channel chat uses the app access token.
 */
export type TwitchAccessToken = string | (() => Promise<string> | string);

export interface TwitchAdapterConfig {
  /** Override the Helix API base URL. Defaults to TWITCH_API_BASE_URL or https://api.twitch.tv/helix. */
  apiBaseUrl?: string;
  /** Override the OAuth base URL. Defaults to TWITCH_AUTH_BASE_URL or https://id.twitch.tv/oauth2. */
  authBaseUrl?: string;
  /** Twitch application client ID. Defaults to TWITCH_CLIENT_ID. */
  clientId?: string;
  /**
   * Twitch application client secret, used to mint app access tokens with the
   * client credentials grant and to refresh the optional user token. Defaults
   * to TWITCH_CLIENT_SECRET.
   */
  clientSecret?: string;
  /**
   * Base64 32-byte AES-256-GCM key used to encrypt the app and user tokens
   * stored in the state adapter. Defaults to TWITCH_ENCRYPTION_KEY. Tokens
   * are stored unencrypted when omitted.
   */
  encryptionKey?: string;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * Refresh token for the bot account's user access token. Enables managed
   * refresh for whispers: the adapter refreshes the user token before expiry
   * and persists the rotated refresh token in the state adapter. Defaults to
   * TWITCH_REFRESH_TOKEN.
   */
  refreshToken?: string;
  /**
   * User access token for the bot account with the `user:manage:whispers`
   * scope, or a provider function that returns a fresh token. Only needed to
   * send whispers. Defaults to TWITCH_USER_ACCESS_TOKEN.
   */
  userAccessToken?: TwitchAccessToken;
  /**
   * User ID of the bot account. Defaults to TWITCH_BOT_USER_ID, else looked up
   * from `userName` with Get Users.
   */
  userId?: string;
  /**
   * Login name of the bot account, used for mention detection. Defaults to
   * TWITCH_BOT_USERNAME, else looked up from `userId` with Get Users.
   */
  userName?: string;
  /**
   * Secret Twitch uses to sign EventSub webhook notifications (10 to 100 ASCII
   * characters). Pass the same value when creating subscriptions. Defaults to
   * TWITCH_WEBHOOK_SECRET.
   */
  webhookSecret?: string;
}

/**
 * Decoded Twitch thread.
 *
 * - `chat`: a broadcaster's chat room, encoded as `twitch:{broadcasterUserId}`.
 * - `whisper`: a whisper conversation with another user, encoded as
 *   `twitch:whisper:{userId}`.
 */
export type TwitchThreadId =
  | { broadcasterUserId: string; kind: "chat" }
  | { kind: "whisper"; userId: string };

/** A chat badge on a `channel.chat.message` event. */
export interface TwitchBadge {
  id: string;
  info: string;
  set_id: string;
}

/** One fragment of a structured chat message. */
export interface TwitchMessageFragment {
  cheermote?: { bits: number; prefix: string; tier: number } | null;
  emote?: {
    emote_set_id: string;
    format?: string[];
    id: string;
    owner_id: string;
  } | null;
  gif?: { id: string; url: string } | null;
  mention?: { user_id: string; user_login: string; user_name: string } | null;
  text: string;
  type: "cheermote" | "emote" | "gif" | "mention" | "text" | (string & {});
}

/** Reply metadata on a `channel.chat.message` event. */
export interface TwitchChatReply {
  parent_message_body: string;
  parent_message_id: string;
  parent_user_id: string;
  parent_user_login: string;
  parent_user_name: string;
  thread_message_id: string;
  thread_user_id: string;
  thread_user_login: string;
  thread_user_name: string;
}

/** The `event` object of a `channel.chat.message` v1 notification. */
export interface TwitchChatMessageEvent {
  badges?: TwitchBadge[];
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  channel_points_custom_reward_id?: string | null;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  cheer?: { bits: number } | null;
  color?: string;
  is_source_only?: boolean | null;
  message: {
    fragments?: TwitchMessageFragment[];
    text: string;
  };
  message_id: string;
  message_type?: string;
  reply?: TwitchChatReply | null;
  source_badges?: TwitchBadge[] | null;
  source_broadcaster_user_id?: string | null;
  source_broadcaster_user_login?: string | null;
  source_broadcaster_user_name?: string | null;
  source_message_id?: string | null;
}

/** The `event` object of a `user.whisper.message` v1 notification. */
export interface TwitchWhisperEvent {
  from_user_id: string;
  from_user_login: string;
  from_user_name: string;
  to_user_id: string;
  to_user_login: string;
  to_user_name: string;
  whisper: { text: string };
  whisper_id: string;
}

/** EventSub subscription metadata, as delivered in webhook bodies and Helix responses. */
export interface TwitchEventSubSubscription {
  condition: Record<string, string>;
  cost?: number;
  created_at: string;
  id: string;
  status: string;
  transport: { callback?: string; method: string };
  type: string;
  version: string;
}

/** Body of an EventSub webhook request. */
export interface TwitchEventSubPayload {
  challenge?: string;
  event?: unknown;
  subscription: TwitchEventSubSubscription;
}

/**
 * Raw Twitch message. `receivedAt` is the EventSub message timestamp (or the
 * send time for outbound messages), since chat events carry no timestamp of
 * their own.
 */
export type TwitchRawMessage =
  | { event: TwitchChatMessageEvent; kind: "chat"; receivedAt?: string }
  | { event: TwitchWhisperEvent; kind: "whisper"; receivedAt?: string };

/** A user returned by Get Users. */
export interface TwitchUser {
  broadcaster_type?: string;
  created_at?: string;
  description?: string;
  display_name: string;
  id: string;
  login: string;
  offline_image_url?: string;
  profile_image_url?: string;
  type?: string;
}

/** One entry in the Send Chat Message response. */
export interface TwitchSendChatMessageResult {
  drop_reason?: { code: string; message: string } | null;
  is_sent: boolean;
  message_id: string;
}

/** Helix list response envelope. */
export interface TwitchApiResponse<TData> {
  data?: TData[];
  max_total_cost?: number;
  pagination?: { cursor?: string };
  total?: number;
  total_cost?: number;
}

/** Helix error body. */
export interface TwitchApiError {
  error?: string;
  message?: string;
  status?: number;
}

/** Response body of POST /oauth2/token. */
export interface TwitchOauthTokenResult {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string[];
  token_type?: string;
}

/** App access token cached in the state adapter. */
export interface TwitchStoredAppToken {
  accessToken: EncryptedTokenData | string;
  expiresAt: number;
}

/** Managed user token persisted in the state adapter. */
export interface TwitchStoredOauthToken {
  accessToken: EncryptedTokenData | string;
  expiresAt: number;
  refreshToken: EncryptedTokenData | string;
  /** SHA-256 hex of the configured refresh token the stored token descends from. */
  seed: string;
}
