/**
 * Type definitions for the XChat adapter.
 *
 * XChat is X's encrypted messaging system. Messages are encrypted
 * client-side with chat-xdk (WASM) and sent/received via the X API (/2/chat/*).
 *
 * @see https://docs.x.com/x-api/direct-messages/introduction
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * XChat adapter configuration.
 *
 * Only `accessToken` and `userId` are required. The adapter fetches
 * `signingKeyVersion` and Juicebox config automatically during `initialize()`
 * by calling `users.getPublicKey(userId)`, then calls chat-xdk `createChat()`.
 *
 * Pass `pin` to auto-unlock after initialize, or call `adapter.unlock(pin)` later.
 */
export interface XchatAdapterConfig {
  /**
   * OAuth2 access token for X API calls. When omitted, resolved from the
   * `XCHAT_BOT_TOKEN` or `X_ACCESS_TOKEN` env var by `createXchatAdapter`.
   */
  accessToken?: string;
  /** Base URL for X API requests. Defaults to https://api.x.com. */
  apiBaseUrl?: string;
  /** Custom HTTP headers to send with every X API request */
  apiHeaders?: Record<string, string>;
  /** OAuth2 access token (alias for `accessToken`). */
  botToken?: string;
  /**
   * App consumer secret (API secret key) for webhook signature verification.
   * When set, incoming POST webhooks are verified via HMAC-SHA256.
   *
   * Required to receive webhooks: without it every POST is rejected with 401.
   * Registering an XChat webhook already needs this secret to answer the CRC
   * challenge, so a working webhook deployment always has one. Polling
   * deployments never receive webhooks and do not need it.
   */
  consumerSecret?: string;
  /**
   * Accept webhook POSTs without verifying their signature.
   *
   * Only set this when the deployment terminates and verifies X's signature
   * upstream. It lets anyone who learns the webhook URL deliver forged
   * envelopes to the adapter, so it is not recommended in production.
   */
  disableWebhookVerification?: boolean;
  /**
   * Minimum age (ms) a freshly posted message must reach before its first
   * edit is sent, giving receiving clients time to store the original an
   * edit targets. Defaults to 5000; 0 disables the wait.
   */
  editSafetyDelayMs?: number;
  /**
   * Logger instance for error reporting. When omitted, `createXchatAdapter`
   * falls back to a console logger.
   */
  logger?: Logger;
  /**
   * Juicebox PIN. When set, initialize() calls unlock(pin) automatically
   * after createChat().
   */
  pin?: string;
  /**
   * When true (default), a read receipt is sent for each inbound message
   * before it is handed to handlers. Set to false to disable.
   */
  sendReadReceipts?: boolean;
  /**
   * Override for the signing key version. When omitted, the adapter
   * fetches it automatically from GET /2/users/{id}/public_keys during
   * initialize(). Only set this if you know what you're doing.
   */
  signingKeyVersion?: string;
  /**
   * Bot @handle for mention detection. When omitted, initialize() loads it
   * from GET /2/users/me.
   */
  userName?: string;
  /**
   * Whether incoming messages must have a verifiable signature.
   *
   * Defaults to `true` (chat-xdk's secure default): a message is only
   * delivered when its signature verifies against a binding-checked signing
   * key for the sender. Messages that can't be verified are dropped.
   *
   * Set to `false` to opt out of signature verification — messages decrypt
   * even when no valid signing key is available. Use only when the binding
   * verification can't be satisfied (e.g. participants registered with an
   * incompatible key format) and you accept the reduced security.
   */
  verifySignatures?: boolean;
  /**
   * Message posted when the bot is added to a group
   * (`chat.conversation_join`). Set to `false` to disable. When omitted, a
   * default that explains @mention-to-reply is used.
   */
  welcomeMessage?: string | false;
}

/**
 * Encryption readiness states for the adapter.
 *
 * - `uninitialized`: initialize() not yet called
 * - `initializing`: initialize() in progress (fetching keys, loading WASM)
 * - `locked`: WASM loaded, Juicebox config fetched, waiting for unlock(pin)
 * - `ready`: Keys loaded, adapter can encrypt/decrypt
 * - `error`: Initialization or unlock failed
 */
export type XchatCryptoStatus =
  | "uninitialized"
  | "initializing"
  | "locked"
  | "ready"
  | "error";

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for XChat.
 *
 * XChat conversations can be 1:1 (userId1-userId2) or groups (gXXXXX).
 *
 * Format: xchat:{conversationId}
 */
export interface XchatThreadId {
  /** The raw conversation ID (e.g. "12345-67890" or "gABCDE") */
  conversationId: string;
}

// =============================================================================
// XAA Event Payloads (X Activity API)
// =============================================================================

/**
 * XAA chat event — the JSON payload delivered via webhook or activity stream.
 *
 * This is the same shape whether delivered via:
 *   - X Activity API webhook POST
 *   - X Activity API persistent HTTP stream
 */
export interface XchatEvent {
  /** The conversation this event belongs to (e.g. "12345:67890" or "gABCDE") */
  conversationId: string;
  /** Base64 key change event for extracting/rotating conversation keys */
  conversationKeyChangeEvent?: string;
  /** Version of the conversation encryption key used */
  conversationKeyVersion?: string;
  /** Conversation token for send continuity */
  conversationToken?: string;
  /** Creation time as ISO 8601 (API conversation events) */
  createdAt?: string;
  /** Timestamp in milliseconds (as string) */
  createdAtMsec?: string;
  /** The base64-encoded encrypted event (the primary payload, decrypted via chat-xdk) */
  encodedEvent: string;
  /** Base64 ECIES-encrypted conversation key for the bot user */
  encryptedConversationKey?: string;
  /** Unique event ID (for dedup) */
  id: string;
  /** Whether the message is from a trusted sender */
  isTrusted?: boolean;
  /** Signature envelope */
  messageEventSignature?: {
    publicKeyVersion?: string;
    signature?: string;
    signatureVersion?: string;
    signingPublicKey?: string;
  };
  /** Previous event ID in the conversation */
  previousId?: string;
  /** Sender's numeric X user ID */
  senderId: string;
  /** Backend sequence id (used for read receipts when present) */
  sequenceId?: string;
}

/**
 * XAA chat event types.
 */
export type XchatEventType =
  | "chat.received"
  | "chat.sent"
  | "chat.conversation_join";

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Platform-specific raw message type for XChat.
 *
 * Contains both the encrypted event envelope and the decrypted content.
 */
export interface XchatRawMessage {
  /** The decrypted event from chat-xdk (null if decryption failed) */
  decrypted: XchatDecryptedEvent | null;
  /** The raw XAA event or API response event */
  event: XchatEvent;
}

/**
 * A decrypted event as returned by chat-xdk. Declared as a plain local
 * interface (instead of importing chat-xdk's types) so consumers don't need
 * chat-xdk as a type dependency.
 */
export interface XchatDecryptedEvent {
  attachments?: XchatAttachmentEntry[];
  content?: {
    text?: string;
    contentType?: string;
    emoji?: string;
    targetMessageId?: string;
    entities?: unknown[];
    attachments?: XchatAttachmentEntry[];
    replyingToPreview?: unknown;
    [key: string]: unknown;
  };
  conversationId?: string;
  createdAtMsec?: number;
  id?: string;
  keyVersion?: string;
  mediaHashes?: Array<{ source?: string; mediaHashKey?: string }>;
  participantKeys?: Array<{
    userId: string;
    encryptedKey: string;
    publicKeyVersion: string;
  }>;
  replyPreviewValidation?: "valid" | "invalid";
  senderId?: string;
  sequenceId?: string;
  ttlMsec?: number;
  type: string;
  verified?: boolean;
  [key: string]: unknown;
}

/**
 * An attachment entry on a decrypted event. Tolerant of both the flattened
 * camelCase shape produced by the chat-xdk JS binding and the nested
 * snake_case `{ media: {...} }` shape seen on some wire payloads.
 */
export interface XchatAttachmentEntry {
  attachmentType?: string;
  dimensions?: { width?: number; height?: number };
  durationMillis?: number;
  filename?: string;
  filesizeBytes?: number;
  media?: {
    media_hash_key?: string;
    mediaHashKey?: string;
    dimensions?: { width?: number; height?: number };
    filesize_bytes?: number;
    filesizeBytes?: number;
    filename?: string;
    media_type?: string;
    mediaType?: string;
    type?: string;
    duration_millis?: number;
    durationMillis?: number;
    [key: string]: unknown;
  };
  mediaHashKey?: string;
  mediaType?: string;
  [key: string]: unknown;
}
