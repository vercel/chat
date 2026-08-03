import type { EncryptedTokenData } from "@chat-adapter/shared";
import type { Logger } from "chat";

/**
 * OAuth 2.0 user-context access token, or an async provider that returns one.
 *
 * X OAuth 2.0 user tokens are short-lived. Either configure managed refresh
 * (`clientId` + `refreshToken`) or pass a provider function that plugs in your
 * own refresh logic, so long-running bots keep working after the initial
 * token expires.
 */
export type XAccessToken = string | (() => Promise<string> | string);

export interface XAdapterConfig {
  /** Override the X API base URL. Defaults to X_API_BASE_URL or https://api.x.com. */
  apiBaseUrl?: string;
  /**
   * OAuth 2.0 client ID, required for managed token refresh together with
   * `refreshToken`. Defaults to X_CLIENT_ID.
   */
  clientId?: string;
  /**
   * OAuth 2.0 client secret for confidential clients. When set, token refresh
   * uses HTTP basic auth. Defaults to X_CLIENT_SECRET.
   */
  clientSecret?: string;
  /**
   * App consumer secret (API secret key) used for webhook CRC responses and
   * `x-twitter-webhooks-signature` verification. Defaults to X_CONSUMER_SECRET.
   */
  consumerSecret?: string;
  /**
   * Base64 32-byte AES-256-GCM key used to encrypt OAuth tokens persisted in
   * the state adapter. Defaults to X_ENCRYPTION_KEY. Tokens are stored
   * unencrypted when omitted.
   */
  encryptionKey?: string;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * OAuth 2.0 refresh token (requires the `offline.access` scope). Together
   * with `clientId` this enables managed refresh: the adapter refreshes the
   * access token before expiry and persists the rotated refresh token in the
   * state adapter. Defaults to X_REFRESH_TOKEN.
   */
  refreshToken?: string;
  /**
   * OAuth 2.0 user-context access token for outbound API calls, or a provider
   * function that returns a fresh token. Defaults to X_USER_ACCESS_TOKEN.
   * Optional when managed refresh (`clientId` + `refreshToken`) is configured.
   */
  userAccessToken?: XAccessToken;
  /** User ID of the authenticated bot account. Defaults to X_USER_ID, else fetched from GET /2/users/me. */
  userId?: string;
  /** Bot account handle used for mention detection. Defaults to X_USERNAME, else fetched from GET /2/users/me. */
  userName?: string;
}

export interface XThreadId {
  /**
   * For `post` threads, the post `conversation_id`. For `dm` threads, the
   * **other participant's user id**: X DM webhooks carry no conversation id,
   * only participant ids, so DMs are threaded by participant and replies use
   * the by-participant send endpoint.
   */
  conversationId: string;
  kind: "dm" | "post";
}

export interface XUser {
  id: string;
  name?: string;
  profile_image_url?: string;
  username?: string;
}

export interface XPostEditControls {
  editable_until?: string;
  edits_remaining?: number;
  is_edit_eligible?: boolean;
}

export interface XPost {
  author_id?: string;
  conversation_id?: string;
  created_at?: string;
  edit_controls?: XPostEditControls;
  id: string;
  in_reply_to_user_id?: string;
  lang?: string;
  text: string;
}

/**
 * Normalized direct message event used internally by the adapter, flattened
 * from the wire shape ({@link XDmActivityPayload}).
 */
export interface XDmEvent {
  /** ISO timestamp, as returned by the v2 REST DM-events lookup. */
  created_at?: string;
  /** Epoch-millis string, as delivered by the Activity API webhook/stream. */
  created_timestamp?: string;
  /** Present only when sourced from a send/lookup response, not from webhooks. */
  dm_conversation_id?: string;
  id: string;
  recipient_id?: string;
  sender_id?: string;
  text?: string;
}

/** A single `message_create` item inside a DM Activity payload. */
export interface XDmWireEvent {
  created_timestamp?: string;
  id: string;
  message_create?: {
    message_data?: { entities?: unknown; text?: string };
    sender_id?: string;
    target?: { recipient_id?: string };
  };
  type?: string;
}

/**
 * DM Activity payload. Legacy Account Activity shape: a
 * `direct_message_events` array plus a `users` map keyed by user id (each
 * user nested under `.data`).
 */
export interface XDmActivityPayload {
  direct_message_events?: XDmWireEvent[];
  users?: Record<string, { data: XUser }>;
}

/**
 * Expansion objects delivered alongside an Activity API event payload.
 *
 * The X Activity API follows the v2 expansion pattern: the payload references
 * users by `author_id` / `sender_id`, and the hydrated user objects arrive
 * here rather than inline on the payload.
 */
export interface XActivityIncludes {
  tweets?: XPost[];
  users?: XUser[];
}

/** One X Activity API event as delivered by webhook or stream. */
export interface XActivityEvent {
  event_type: string;
  event_uuid?: string;
  filter?: { user_id?: string };
  includes?: XActivityIncludes;
  payload: unknown;
  tag?: string;
}

export interface XActivityEnvelope {
  data?: XActivityEvent | XActivityEvent[];
}

export type XRawMessage =
  | { author?: XUser; kind: "post"; post: XPost }
  | { dmEvent: XDmEvent; kind: "dm"; sender?: XUser };

export interface XApiError {
  detail?: string;
  message?: string;
  title?: string;
}

export interface XApiResponse<TData> {
  data?: TData;
  errors?: XApiError[];
  includes?: { users?: XUser[] };
  meta?: {
    next_token?: string;
    previous_token?: string;
    result_count?: number;
  };
}

export interface XPostCreateResult {
  id: string;
  text?: string;
}

export interface XDmSendResult {
  dm_conversation_id: string;
  dm_event_id: string;
}

/** Response body of the /2/media/upload INIT, FINALIZE, and STATUS commands. */
export interface XMediaUploadResult {
  expires_after_secs?: number;
  id: string;
  media_key?: string;
  processing_info?: {
    state: "pending" | "in_progress" | "succeeded" | "failed";
    check_after_secs?: number;
    progress_percent?: number;
    error?: { code?: number; name?: string; message?: string };
  };
}

/** Response body of POST /2/oauth2/token. */
export interface XOauthTokenResult {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

/** Managed OAuth token persisted in the state adapter. */
export interface XStoredOauthToken {
  accessToken: EncryptedTokenData | string;
  expiresAt: number;
  refreshToken: EncryptedTokenData | string;
}
