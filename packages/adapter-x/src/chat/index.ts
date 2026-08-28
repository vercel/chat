/**
 * XChat adapter for chat SDK.
 *
 * Provides encrypted messaging via the X API (/2/chat/*) and chat-xdk WASM.
 * All conversations are encrypted — the adapter handles key extraction, decryption,
 * encryption, and signing transparently.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createXchatAdapter } from "@chat-adapter/x/chat";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     xchat: createXchatAdapter(),
 *   },
 *   state: new MemoryState(),
 * });
 * ```
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { AdapterError, ValidationError } from "@chat-adapter/shared";
import {
  type AttachmentDescriptor,
  type ChatWithJuicebox,
  type ConversationKeyResult,
  createChat,
  detectImageDimensions,
  detectMimeType,
  type EncryptMessageParams,
  type EntityTuple,
  type PublicKeyInput,
  type SendPayload,
  type SigningKeyEntry,
  type UrlAttachmentImageDescriptor,
} from "@xdevplatform/chat-xdk";
import { Client } from "@xdevplatform/xdk";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  CardElement,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  Logger,
  RawMessage,
  ReactionEvent,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  defaultEmojiResolver,
  getEmoji,
  isCardElement,
  Message,
  parseMarkdown,
} from "chat";
import { cardToXChat, type XchatUrlCardSpec } from "./cards";
import { XchatFormatConverter } from "./markdown";
import type {
  XchatAdapterConfig,
  XchatAttachmentEntry,
  XchatCryptoStatus,
  XchatDecryptedEvent,
  XchatEvent,
  XchatRawMessage,
  XchatThreadId,
} from "./types";

/** Default base URL for X API requests */
const DEFAULT_API_BASE_URL = "https://api.x.com";

/** Adapter version, read from package.json (works from both src and dist). */
const ADAPTER_VERSION: string = createRequire(import.meta.url)(
  "../../package.json"
).version;

/** Product token identifying Chat SDK traffic in X API request logs */
const CHAT_SDK_UA_TOKEN = `chat-sdk-xchat/${ADAPTER_VERSION}`;

/**
 * Prepend the Chat SDK product token to a User-Agent, keeping the existing
 * value (the xdk client's own token) so both products stay identifiable.
 * No-op when the token is already present.
 */
export function withChatSdkUserAgent(existing: string | null): string {
  if (!existing) {
    return CHAT_SDK_UA_TOKEN;
  }
  if (existing.includes("chat-sdk-xchat/")) {
    return existing;
  }
  return `${CHAT_SDK_UA_TOKEN} ${existing}`;
}

/** Re-send the typing indicator this often while a handler is running */
const TYPING_INTERVAL_MS = 3000;
/** Stop the typing keep-alive loop after this long regardless */
const TYPING_MAX_MS = 120_000;

/** Media upload append chunk size (pre-base64) */
const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

/** Cap on the messageId → sequenceId cache used for reactions/read receipts */
const SEQUENCE_CACHE_MAX = 1000;
/**
 * Minimum age a freshly posted message must reach before its first edit is
 * sent. Receiving clients apply an edit to their stored copy of the original
 * and park it when the original has not arrived yet; because the backend
 * stops serving a superseded original, an edit that outruns delivery leaves
 * the message permanently invisible to that client.
 */
const DEFAULT_EDIT_SAFETY_DELAY_MS = 5000;

/**
 * Fields requested for message events from GET
 * /2/chat/conversations/{id}/events. This list must stay within the API's
 * chat_message_event.fields enum — unknown values fail the whole request.
 * The sequence id is not requestable here; it comes from the decrypted
 * event's meta instead.
 */
const MESSAGE_EVENT_FIELDS = [
  "conversation_id",
  "conversation_token",
  "created_at",
  "encoded_event",
  "id",
  "is_trusted",
  "message_event_signature",
  "previous_id",
  "sender_id",
] as const;

/**
 * Field-list type for getConversationEvents. The API accepts `created_at`,
 * which @xdevplatform/xdk's generated field union does not yet include, so
 * call sites cast through this alias instead of the SDK's union.
 */
type MessageEventFields = NonNullable<
  Parameters<InstanceType<typeof Client>["chat"]["getConversationEvents"]>[1]
>["chatMessageEventFields"];

/**
 * Public-key fields requested when fetching participants' signing keys.
 *
 * All four are needed to build a chat-xdk SigningKeyEntry that supports
 * full signature + key-binding verification:
 *   - public_key_version            → publicKeyVersion
 *   - signing_public_key            → publicKey (the signing key itself)
 *   - public_key                    → identityPublicKey
 *   - identity_public_key_signature → identityPublicKeySignature
 */
const SIGNING_KEY_FIELDS = [
  "public_key_version",
  "public_key",
  "signing_public_key",
  "identity_public_key_signature",
] as const;

/** Splits a 1:1 conversation ID into its participant IDs. */
const CONVERSATION_ID_SEPARATOR = /[-:]/;
/** Matches a numeric X user ID. */
const NUMERIC_USER_ID = /^\d+$/;

/** Prefer `publicKeyVersion`; older API responses carry the same value as `version`. */
function publicKeyVersionOf(key: {
  publicKeyVersion?: string;
  version?: string;
}): string | undefined {
  return key.publicKeyVersion ?? key.version;
}

/**
 * Public key entry from users.getPublicKey — only the fields the adapter
 * reads. `version` is the older-response alias for `publicKeyVersion`.
 */
interface PublicKeyData {
  identityPublicKeySignature?: string;
  juiceboxConfig?: {
    keyStoreTokenMapJson?: string;
    tokenMap?: Array<{
      key: string;
      value: { address: string; token: string };
    }>;
  };
  /** Identity public key (base64) */
  publicKey?: string;
  publicKeyVersion?: string;
  /** Signing public key (base64) */
  signingPublicKey?: string;
  version?: string;
}

/** Minimal X API response envelope (`data` shape varies per endpoint). */
interface XApiResponse<T> {
  data?: T;
}

/**
 * Response envelope for GET /2/chat/conversations/{id}/events. Events carry
 * the same fields as webhook events; `next_token` covers untransformed
 * snake_case responses.
 */
interface ConversationEventsResponse {
  data?: Partial<XchatEvent>[];
  meta?: { nextToken?: string; next_token?: string };
}

/**
 * Path segment for chat REST routes (`/2/chat/conversations/{id}/…`).
 *
 * 1:1 conversations accept the other participant's user id (no `:`/`-`
 * composite). Groups use the opaque `g…` conversation id as-is.
 */
export function conversationPathId(
  conversationId: string,
  selfUserId: string
): string {
  if (conversationId.startsWith("g")) {
    return conversationId;
  }
  const other = conversationId
    .split(CONVERSATION_ID_SEPARATOR)
    .filter((part) => NUMERIC_USER_ID.test(part))
    .find((id) => id !== selfUserId);
  return other ?? conversationId;
}

/**
 * Conversation id for routes that take it as a path parameter (media
 * download, key initialization), which accept only the dash-joined
 * participant pair or the g-prefixed group id.
 */
export function dashConversationId(conversationId: string): string {
  if (conversationId.startsWith("g")) {
    return conversationId;
  }
  return conversationId.replace(":", "-");
}

// ── Outgoing entity + attachment detection ────────────────────────────

/**
 * URL matcher for outgoing entities: full http(s) URLs plus common bare
 * domains. False positives are low-cost (link underline); false negatives
 * mean no tappable link.
 */
const URL_ENTITY_RE =
  /https?:\/\/[^\s\])>"']+|(?<![@\w])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|org|net|io|co|ai|dev|app|xyz|me|info|gg|tv|ly|to|so|fm|cc|sh|ws|is)(?:\/[^\s\])>"']*)?/gi;

/** @handle matcher (1-15 word chars); lookbehind excludes email-like text. */
const MENTION_ENTITY_RE =
  /(?<![A-Za-z0-9_.])@[A-Za-z0-9_]{1,15}(?![A-Za-z0-9_])/g;

/** X post URLs: x.com/<user>/status/<id> or twitter.com/<user>/status/<id> */
const POST_URL_RE =
  /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d+)/gi;

/** Strips a leading @ from a handle. */
const LEADING_AT_RE = /^@/;

/**
 * Detect URL and @mention entities in outgoing text.
 *
 * Returns `[start, end, type]` tuples for `encryptMessage`/`encryptReply`,
 * or null when nothing was found. Mentions overlapping a detected URL span
 * (e.g. an @ inside a URL path) are skipped.
 */
export function detectEntities(text: string): EntityTuple[] | null {
  const entities: EntityTuple[] = [];
  for (const m of text.matchAll(URL_ENTITY_RE)) {
    entities.push([m.index, m.index + m[0].length, "url"]);
  }
  for (const m of text.matchAll(MENTION_ENTITY_RE)) {
    const start = m.index;
    if (entities.some((e) => e[0] <= start && start < e[1])) {
      continue;
    }
    entities.push([start, start + m[0].length, "mention"]);
  }
  entities.sort((a, b) => a[0] - b[0]);
  return entities.length > 0 ? entities : null;
}

/**
 * Extract X post URLs from text as post-card attachment descriptors,
 * deduplicated by post id. Returns null when none found.
 */
export function extractPostAttachments(
  text: string
): AttachmentDescriptor[] | null {
  const seen = new Set<string>();
  const attachments: AttachmentDescriptor[] = [];
  for (const m of text.matchAll(POST_URL_RE)) {
    const postId = m[1];
    if (seen.has(postId)) {
      continue;
    }
    seen.add(postId);
    attachments.push({
      attachment_type: "post",
      rest_id: postId,
      post_url: m[0],
    });
  }
  return attachments.length > 0 ? attachments : null;
}

/** The card carried by a postable message, if any. */
function cardOf(message: AdapterPostableMessage): CardElement | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  if ("card" in message && isCardElement(message.card)) {
    return message.card;
  }
  return isCardElement(message) ? message : null;
}

// ── Inbound event helpers ─────────────────────────────────────────────

/** Tolerant accessor: chat-xdk JS emits camelCase, wire payloads snake_case. */
function fieldOf(obj: unknown, camel: string, snake: string): unknown {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  return rec[camel] ?? rec[snake];
}

/**
 * Extract @-mentioned handles from a decrypted message's rich-text
 * entities. Handles are lowercased, without the leading `@`, deduplicated.
 */
export function mentionHandlesFromEntities(
  text: string,
  entities: unknown[] | undefined
): string[] {
  if (!entities || entities.length === 0 || !text) {
    return [];
  }
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const entity of entities) {
    if (!entity || typeof entity !== "object") {
      continue;
    }
    const content = (entity as Record<string, unknown>).content;
    if (!content || typeof content !== "object") {
      continue;
    }
    if (!("mention" in (content as Record<string, unknown>))) {
      continue;
    }
    const startRaw = fieldOf(entity, "startIndex", "start_index");
    const endRaw = fieldOf(entity, "endIndex", "end_index");
    if (startRaw == null || endRaw == null) {
      continue;
    }
    const start = Math.max(0, Number(startRaw));
    const end = Math.min(text.length, Number(endRaw));
    if (!(Number.isFinite(start) && Number.isFinite(end)) || start >= end) {
      continue;
    }
    const handle = text
      .slice(start, end)
      .replace(LEADING_AT_RE, "")
      .toLowerCase();
    if (handle && !seen.has(handle)) {
      seen.add(handle);
      handles.push(handle);
    }
  }
  return handles;
}

/** Reply-to preview (swipe reply) from decrypted content, if present. */
function replyPreviewOf(
  content: XchatDecryptedEvent["content"]
): { senderId?: string; text?: string } | null {
  const preview = fieldOf(content, "replyingToPreview", "replying_to_preview");
  if (!preview || typeof preview !== "object") {
    return null;
  }
  const senderId = fieldOf(preview, "senderId", "sender_id");
  const text = (preview as Record<string, unknown>).text;
  return {
    senderId: senderId == null ? undefined : String(senderId),
    text: typeof text === "string" ? text : undefined,
  };
}

/** Lowercased content type, tolerant of both binding spellings. */
function contentTypeOf(content: XchatDecryptedEvent["content"]): string {
  const ct = fieldOf(content, "contentType", "content_type");
  return typeof ct === "string" ? ct.toLowerCase() : "";
}

/**
 * Whether a decrypted event is a processable chat message, and its text.
 *
 * Processable messages are: plain text; media (with or without caption);
 * anything carrying attachments/media hashes; and card-like content with
 * URL entities. Reactions/edits/mark-read return null.
 */
function processableText(decrypted: XchatDecryptedEvent | null): string | null {
  if (!decrypted || decrypted.type.toLowerCase() !== "message") {
    return null;
  }
  const content = decrypted.content ?? {};
  const text = typeof content.text === "string" ? content.text : "";
  const ct = contentTypeOf(content);
  if (ct === "text" || ct === "media" || ct === "mediawithtext") {
    return text;
  }
  if (decrypted.attachments?.length || decrypted.mediaHashes?.length) {
    return text;
  }
  if (content.attachments?.length) {
    return text;
  }
  for (const entity of content.entities ?? []) {
    const ec = fieldOf(entity, "content", "content");
    if (ec && typeof ec === "object" && "url" in (ec as object)) {
      return text;
    }
  }
  return ct ? null : text;
}

/** Normalized media reference extracted from a decrypted message. */
interface MediaEntry {
  durationMillis?: number;
  filename?: string;
  filesize?: number;
  hashKey: string;
  height?: number;
  mediaType: string;
  width?: number;
}

function mediaTypeFromSource(source: string | undefined): string {
  const value = (source ?? "").toLowerCase();
  if (value.includes("gif")) {
    return "gif";
  }
  if (value.includes("video")) {
    return "video";
  }
  if (value.includes("image")) {
    return "image";
  }
  return "media";
}

/** Extract all media references (hash keys + metadata) from a decrypted event. */
export function extractMediaEntries(
  decrypted: XchatDecryptedEvent
): MediaEntry[] {
  const entries: MediaEntry[] = [];
  const seen = new Set<string>();

  const addFromAttachment = (entry: XchatAttachmentEntry): void => {
    // Nested `{ media: {...} }` (wire shape) or flattened (JS binding shape)
    const media = entry.media ?? entry;
    const hashKey =
      fieldOf(media, "mediaHashKey", "media_hash_key") ??
      (entry.attachmentType === "media" ? entry.mediaHashKey : undefined);
    if (!hashKey || seen.has(String(hashKey))) {
      return;
    }
    seen.add(String(hashKey));
    const dims = (media as XchatAttachmentEntry).dimensions;
    const rawType =
      fieldOf(media, "mediaType", "media_type") ??
      (media as Record<string, unknown>).type;
    entries.push({
      mediaType: String(rawType ?? "media").toLowerCase(),
      hashKey: String(hashKey),
      width: dims?.width,
      height: dims?.height,
      filename: (fieldOf(media, "filename", "filename") ?? undefined) as
        | string
        | undefined,
      filesize: Number(
        fieldOf(media, "filesizeBytes", "filesize_bytes") ?? Number.NaN
      ),
      durationMillis: Number(
        fieldOf(media, "durationMillis", "duration_millis") ?? Number.NaN
      ),
    });
  };

  for (const entry of decrypted.attachments ?? []) {
    addFromAttachment(entry);
  }
  for (const entry of decrypted.content?.attachments ?? []) {
    addFromAttachment(entry);
  }
  for (const ref of decrypted.mediaHashes ?? []) {
    const hashKey = ref.mediaHashKey;
    if (!hashKey || seen.has(hashKey)) {
      continue;
    }
    seen.add(hashKey);
    entries.push({
      mediaType: mediaTypeFromSource(ref.source),
      hashKey,
    });
  }
  return entries;
}

/** Map an XChat media type string onto the Chat SDK attachment type. */
function chatAttachmentType(mediaType: string): Attachment["type"] {
  if (mediaType === "video") {
    return "video";
  }
  if (mediaType === "audio") {
    return "audio";
  }
  if (mediaType === "image" || mediaType === "gif") {
    return "image";
  }
  return "file";
}

/** Numeric media_type for outgoing attachment descriptors, keyed by MIME. */
function outgoingMediaType(mimeType: string): number | undefined {
  if (mimeType === "image/gif") {
    return 2;
  }
  if (mimeType.startsWith("video/")) {
    return 3;
  }
  if (mimeType.startsWith("audio/")) {
    return 4;
  }
  if (mimeType.startsWith("image/")) {
    // Image is the server default.
    return undefined;
  }
  return 5;
}

/** Latest-message context per conversation, for group quote-replies + TTL. */
interface InboundContext {
  createdAtMsec?: number;
  encodedEvent?: string;
  senderId?: string;
  sequenceId?: string;
  text?: string;
  ttlMsec?: number;
}

/** Normalize the Chat SDK's binary payload shapes to Uint8Array. */
async function toBytes(
  data: Buffer | Blob | ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  // Blob (Buffer is a Uint8Array subclass, handled above)
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

export type { XchatCardResult, XchatUrlCardSpec } from "./cards";
export { cardToXChat } from "./cards";
export { XchatFormatConverter } from "./markdown";
export type {
  XchatAdapterConfig,
  XchatAttachmentEntry,
  XchatCryptoStatus,
  XchatDecryptedEvent,
  XchatEvent,
  XchatRawMessage,
  XchatThreadId,
} from "./types";

/**
 * XChat adapter for chat SDK.
 *
 * Handles encrypted messaging via the X API and chat-xdk WASM crypto.
 * All conversations are 1:1 DMs or group chats, always encrypted.
 */
export class XchatAdapter implements Adapter<XchatThreadId, XchatRawMessage> {
  readonly name = "xchat";
  readonly persistMessageHistory = true;
  private _userName: string;
  private readonly userNameFromConfig: boolean;

  private readonly accessToken: string;
  private readonly apiHeaders: Record<string, string>;
  private readonly consumerSecret: string | undefined;
  /** Bot user id (from config or resolved from GET /2/users/me) */
  private userId: string;
  /** Populated during initialize() from the X API, or from config override */
  private signingKeyVersion: string | null;
  /** Juicebox PIN; when set, initialize() auto-unlocks after createChat */
  private readonly pin: string | undefined;
  /** When false, decryption proceeds even for unverifiable signatures */
  private readonly verifySignatures: boolean;
  /** When true, webhook POSTs are accepted without a signature check */
  private readonly disableWebhookVerification: boolean;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new XchatFormatConverter();
  private xdkClient: InstanceType<typeof Client> | null = null;
  private cryptoEngine: ChatWithJuicebox | null = null;
  private _cryptoStatus: XchatCryptoStatus = "uninitialized";
  /** Saved getAuthToken callback for re-installing on unlock() */
  private _getAuthToken: ((realmId: string) => Promise<string>) | null = null;
  /**
   * Cached conversation keys: conversationId → { version → raw bytes }.
   * Grows by one small entry per conversation the bot participates in;
   * evicting a key would only force a re-fetch through conversation history,
   * so the cache is kept unbounded for the process lifetime.
   */
  private readonly conversationKeys = new Map<string, ConversationKeyResult>();
  /** Cached conversation tokens: conversationId → token (one per conversation) */
  private readonly conversationTokens = new Map<string, string>();
  /** Cached signing keys: userId → SigningKeyEntry[] (one per key version, one entry per user ever seen) */
  private readonly signingKeyCache = new Map<string, SigningKeyEntry[]>();
  /** Base URL for X API requests */
  private readonly apiBaseUrl: string;
  /** Welcome message posted on group join; false disables */
  private readonly welcomeMessage: string | false | undefined;
  /** Latest inbound message context per conversation (quote-replies, TTL) */
  private readonly lastInboundByConv = new Map<string, InboundContext>();
  /** messageId → sequenceId, for reactions + per-message read receipts */
  private readonly sequenceIdByMessageId = new Map<string, string>();
  /** sequenceId → messageId, for resolving inbound reaction targets */
  private readonly messageIdBySequenceId = new Map<string, string>();
  /** messageId → post time, for age-gating the first edit of a fresh message */
  private readonly postedAtByMessageId = new Map<string, number>();
  /** Minimum age of a message before its first edit is sent */
  private readonly editSafetyDelayMs: number;
  /** Whether a read receipt is sent for each delivered inbound message */
  private readonly sendReadReceipts: boolean;
  /** Active typing keep-alive timers per conversation */
  private readonly typingTimers = new Map<
    string,
    ReturnType<typeof setInterval>
  >();

  /** Bot @handle used for mention detection (from config or GET /2/users/me) */
  get userName(): string {
    return this._userName;
  }

  /** Bot user ID (same as userId for XChat) */
  get botUserId(): string | undefined {
    return this.userId;
  }

  /** Current encryption readiness status */
  get cryptoStatus(): XchatCryptoStatus {
    return this._cryptoStatus;
  }

  constructor(
    config: XchatAdapterConfig & {
      accessToken: string;
      logger: Logger;
      /** Skips the /2/users/me identity resolution (used in tests). */
      userId?: string;
    }
  ) {
    this.accessToken = config.accessToken;
    this.apiHeaders = { ...config.apiHeaders };
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.consumerSecret = config.consumerSecret;
    this.userId = config.userId ?? "";
    this.signingKeyVersion = config.signingKeyVersion ?? null;
    this.pin = config.pin;
    this.verifySignatures = config.verifySignatures ?? true;
    this.disableWebhookVerification = Boolean(
      config.disableWebhookVerification
    );
    this.welcomeMessage = config.welcomeMessage;
    this.editSafetyDelayMs =
      config.editSafetyDelayMs ?? DEFAULT_EDIT_SAFETY_DELAY_MS;
    this.sendReadReceipts = config.sendReadReceipts !== false;
    this.userNameFromConfig = Boolean(config.userName);
    this._userName = config.userName ?? "xchat-bot";
    this.logger = config.logger;
  }

  // ── Adapter lifecycle ─────────────────────────────────────────────

  /**
   * Initialize the adapter.
   *
   * 1. Create the XDK API client (and resolve the bot @handle when needed)
   * 2. Fetch signingKeyVersion + Juicebox config from users.getPublicKey()
   * 3. Build the realm token cache from the initial response
   * 4. createChat() (Juicebox-backed crypto); when `pin` was provided →
   *    unlock(pin), otherwise status stays `"locked"`
   */
  async initialize(chatInstance: ChatInstance): Promise<void> {
    this.chat = chatInstance;
    this._cryptoStatus = "initializing";

    if (!(this.consumerSecret || this.disableWebhookVerification)) {
      this.logger.warn(
        "XChat adapter: consumerSecret is not set — incoming webhook POSTs " +
          "will be rejected with 401. Set X_CONSUMER_SECRET to enable webhook " +
          "authentication, or disableWebhookVerification: true to accept " +
          "unverified webhooks (NOT recommended in production). Polling " +
          "deployments are unaffected."
      );
    }

    try {
      // 1. Initialize XDK API client
      this.xdkClient = new Client({
        accessToken: this.accessToken,
        baseUrl: this.apiBaseUrl,
        headers: this.apiHeaders,
      });

      // Mark this client's traffic as Chat SDK in X API request logs by
      // prepending our product token to the xdk client's User-Agent. A
      // User-Agent supplied via apiHeaders wins and is left untouched.
      const userAgentFromConfig = Object.keys(this.apiHeaders).some(
        (name) => name.toLowerCase() === "user-agent"
      );
      if (!userAgentFromConfig) {
        this.xdkClient.headers.set(
          "user-agent",
          withChatSdkUserAgent(this.xdkClient.headers.get("user-agent"))
        );
      }

      // Resolve identity from /2/users/me unless the caller provided both
      // the user id and the @handle explicitly.
      if (!(this.userId && this.userNameFromConfig)) {
        const me = await this.xdkClient.users.getMe();
        const id = me?.data?.id;
        const username = me?.data?.username;
        if (!this.userId) {
          if (typeof id !== "string" || id.length === 0) {
            throw new Error(
              "GET /2/users/me did not return a user id for the configured token"
            );
          }
          this.userId = id;
        }
        if (!this.userNameFromConfig) {
          if (typeof username === "string" && username.length > 0) {
            this._userName = username;
          } else {
            this.logger.warn(
              "GET /2/users/me did not return a username; keeping placeholder",
              { userName: this._userName }
            );
          }
        }
        this.logger.info("Resolved bot identity from /2/users/me", {
          userId: this.userId,
          userName: this._userName,
        });
      }

      // 2. Fetch signing key version + Juicebox config from the X API
      //    (signingKeyVersion may already be set via config override)
      //
      //    XDK response (camelCase — transformKeys converts snake_case from API):
      //    {
      //      data: [{
      //        publicKeyVersion: "1733889755256",
      //        juiceboxConfig: {
      //          keyStoreTokenMapJson: "{ \"realms\": [...], ... }",
      //          maxGuessCount: 20,
      //          tokenMap: [{ key: "realmHex", value: { address: "...", token: "jwt" } }]
      //        }
      //      }]
      //    }
      let juiceboxConfigJson: string | null = null;
      let tokenMapEntries: Array<{
        key: string;
        value: { address: string; token: string };
      }> = [];

      const response = await this.xdkClient.users.getPublicKey(this.userId, {
        publicKeyFields: ["public_key_version", "juicebox_config"],
      });
      const keys = (response as XApiResponse<PublicKeyData[]>).data ?? [];
      if (keys.length === 0) {
        throw new Error(
          "No public key data returned from users.getPublicKey()"
        );
      }
      // Pick the latest version (highest numeric version string)
      const publicKey = keys.reduce((latest, current) => {
        const latestVersion = publicKeyVersionOf(latest) ?? "0";
        const currentVersion = publicKeyVersionOf(current) ?? "0";
        return Number(currentVersion) > Number(latestVersion)
          ? current
          : latest;
      });

      if (!this.signingKeyVersion) {
        this.signingKeyVersion = publicKeyVersionOf(publicKey) ?? null;
      }
      const jbConfig = publicKey.juiceboxConfig;
      if (jbConfig) {
        juiceboxConfigJson = jbConfig.keyStoreTokenMapJson ?? null;
        tokenMapEntries = jbConfig.tokenMap ?? [];
      }

      this.logger.debug("Fetched public key info", {
        signingKeyVersion: this.signingKeyVersion,
        hasJuiceboxConfig: !!juiceboxConfigJson,
        realmCount: tokenMapEntries.length,
      });

      if (!juiceboxConfigJson) {
        // Throw like every other initialization failure so a misconfigured
        // bot fails fast instead of surfacing "locked" errors per call.
        throw new Error(
          "XChat adapter: no Juicebox config found on the user's public key. " +
            "Register keys (setup/PIN) before initializing the adapter."
        );
      }

      // 3. Build realm token cache from the initial response
      const realmTokenCache = new Map<string, string>();
      for (const entry of tokenMapEntries) {
        realmTokenCache.set(entry.key, entry.value.token);
      }

      // 4. createChat (Juicebox) — unlock with pin when provided
      const xdk = this.xdkClient;
      const userId = this.userId;
      const logger = this.logger;

      const getAuthToken = async (realmId: string): Promise<string> => {
        const cached = realmTokenCache.get(realmId);
        if (cached) {
          return cached;
        }

        logger.debug("Fetching fresh Juicebox realm token", { realmId });
        const freshResponse = await xdk.users.getPublicKey(userId, {
          publicKeyFields: ["juicebox_config"],
        });
        const freshKeys =
          (freshResponse as XApiResponse<PublicKeyData[]>).data ?? [];
        const freshKey = freshKeys.reduce((latest, current) => {
          const latestVersion = publicKeyVersionOf(latest) ?? "0";
          const currentVersion = publicKeyVersionOf(current) ?? "0";
          return Number(currentVersion) > Number(latestVersion)
            ? current
            : latest;
        });
        const freshEntries: Array<{ key: string; value: { token: string } }> =
          freshKey?.juiceboxConfig?.tokenMap ?? [];

        for (const entry of freshEntries) {
          realmTokenCache.set(entry.key, entry.value.token);
        }

        const token = realmTokenCache.get(realmId);
        if (!token) {
          throw new Error(`No Juicebox auth token found for realm ${realmId}`);
        }
        return token;
      };

      this._getAuthToken = getAuthToken;

      const crypto = await createChat({
        juiceboxConfig: juiceboxConfigJson,
        getAuthToken,
      });
      // chat-xdk defaults to reject-unverified; only override when opting out
      if (!this.verifySignatures) {
        crypto.setRejectUnverified(false);
      }
      this.cryptoEngine = crypto;
      this._cryptoStatus = "locked";
      this.logger.info("XChat adapter initialized (Juicebox, locked)", {
        userId: this.userId,
        userName: this._userName,
        realmCount: realmTokenCache.size,
      });

      if (this.pin) {
        await this.unlock(this.pin);
      }
    } catch (err) {
      this._cryptoStatus = "error";
      this.logger.error("XChat adapter initialization failed", { error: err });
      throw err;
    }
  }

  /**
   * Unlock encryption keys with a Juicebox PIN.
   *
   * Only available when `cryptoStatus === "locked"`.
   * After successful unlock, `cryptoStatus` becomes `"ready"`.
   */
  async unlock(pin: string): Promise<void> {
    if (this._cryptoStatus !== "locked") {
      throw new Error(
        `Cannot unlock: adapter is "${this._cryptoStatus}" (expected "locked"). ` +
          (this._cryptoStatus === "ready"
            ? "Already unlocked."
            : "Call initialize() first.")
      );
    }

    // chat-xdk's createChat() sets globalThis.JuiceboxGetAuthToken only during
    // construction, then restores the previous value. But the Juicebox SDK
    // needs the global set when recover() is called during unlock().
    // Install this adapter's getAuthToken callback for the duration of the
    // unlock call, then restore the previous value so multiple adapters in
    // one process don't clobber each other's callback.
    interface JuiceboxGlobal {
      JuiceboxGetAuthToken?: (realmId: Uint8Array | string) => Promise<string>;
    }
    const jbGlobal = globalThis as JuiceboxGlobal;
    const previousGetAuthToken = jbGlobal.JuiceboxGetAuthToken;
    const getAuthToken = this._getAuthToken;
    if (getAuthToken) {
      jbGlobal.JuiceboxGetAuthToken = async (realmId: Uint8Array | string) => {
        const realmIdHex =
          typeof realmId === "string"
            ? realmId
            : Array.from(realmId)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        return await getAuthToken(realmIdHex);
      };
    }

    const jbChat = this.cryptoEngine as ChatWithJuicebox;
    try {
      await jbChat.unlock(pin);
    } finally {
      jbGlobal.JuiceboxGetAuthToken = previousGetAuthToken;
    }
    // Establish the session identity (sender id + registered signing key
    // version) so chat-xdk signs with the right key version and handles
    // KeyChange events for other versions correctly.
    if (this.signingKeyVersion) {
      try {
        jbChat.setIdentity(this.userId, this.signingKeyVersion);
      } catch (err) {
        this.logger.warn("setIdentity failed", { error: err });
      }
    }
    this._cryptoStatus = "ready";
    this.logger.info("XChat adapter unlocked via PIN");
  }

  // ── Thread ID encoding ────────────────────────────────────────────

  encodeThreadId(data: XchatThreadId): string {
    return `xchat:${data.conversationId}`;
  }

  decodeThreadId(threadId: string): XchatThreadId {
    if (!threadId.startsWith("xchat:")) {
      throw new Error(`Invalid XChat thread ID: ${threadId}`);
    }
    const conversationId = threadId.slice("xchat:".length);
    if (!conversationId) {
      throw new Error(`Invalid XChat thread ID format: ${threadId}`);
    }
    return { conversationId };
  }

  channelIdFromThreadId(threadId: string): string {
    // XChat doesn't have channels — the conversation IS the channel
    return threadId;
  }

  // ── Webhook handling ──────────────────────────────────────────────

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (request.method !== "POST") {
      // CRC challenges (GET) should be handled at the route level,
      // not here — they don't need adapter initialization or crypto.
      return new Response("Method not allowed", { status: 405 });
    }

    // Read the raw body for signature verification
    const rawBody = await request.text();

    // Fail closed: an unsigned POST is rejected unless the operator has
    // explicitly opted out. Registering an XChat webhook already requires the
    // consumer secret to answer the CRC challenge, so a working webhook
    // deployment always has one. Polling deployments never reach this path.
    if (this.consumerSecret) {
      const signature = request.headers.get("x-twitter-webhooks-signature");
      if (!signature) {
        this.logger.warn("webhook_missing_signature");
        return new Response("Missing signature", { status: 401 });
      }
      if (!this.verifySignature(rawBody, signature)) {
        this.logger.warn("webhook_invalid_signature");
        return new Response("Invalid signature", { status: 401 });
      }
    } else if (!this.disableWebhookVerification) {
      this.logger.warn("webhook_verification_unconfigured");
      return new Response("Signature verification not configured", {
        status: 401,
      });
    }

    // Parse the XAA webhook envelope and extract the event payload.
    //
    // XAA wraps the event in:
    //   { data: { event_type, event_uuid, filter, tag, payload: { ...event } } }
    // Wire format is snake_case (raw HTTP body — not via XDK transformKeys).
    let event: XchatEvent;
    let eventType: string;
    try {
      const body = JSON.parse(rawBody);
      const xaaData = body.data ?? body;
      const payload = xaaData.payload ?? xaaData;
      eventType = xaaData.event_type ?? "chat.received";
      const conversationId = String(payload.conversation_id ?? "");
      const encodedEvent = String(payload.encoded_event ?? "");
      if (!(conversationId && encodedEvent)) {
        return new Response("OK", { status: 200 });
      }
      event = {
        id: String(payload.id ?? ""),
        conversationId,
        senderId: String(payload.sender_id ?? ""),
        encodedEvent,
        conversationKeyVersion: payload.conversation_key_version,
        conversationKeyChangeEvent: payload.conversation_key_change_event,
        conversationToken: payload.conversation_token,
        encryptedConversationKey: payload.encrypted_conversation_key,
        createdAtMsec: payload.created_at_msec,
        messageEventSignature: payload.message_event_signature,
        sequenceId: payload.sequence_id
          ? String(payload.sequence_id)
          : undefined,
      };
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Handle conversation join (bot added to group) before the echo skip —
    // the join event's sender may be the bot itself.
    if (eventType === "chat.conversation_join") {
      this.handleConversationJoin(event, options);
      return new Response("OK", { status: 200 });
    }

    // Skip echo events (messages sent by the bot itself)
    if (eventType === "chat.sent" || event.senderId === this.userId) {
      return new Response("OK", { status: 200 });
    }

    // chat.received — decrypt, then route to the message or reaction pipeline
    const threadId = this.encodeThreadId({
      conversationId: event.conversationId,
    });

    const task = (async () => {
      const parsed = await this.decryptAndParseEvent(event);
      const decrypted = parsed.raw?.decrypted ?? null;
      const ct = contentTypeOf(decrypted?.content);

      if (ct === "reaction" || ct === "reactionremoved") {
        this.routeReaction(threadId, parsed, ct === "reaction", options);
        return;
      }

      // Same guards as the poll path (handleIncomingEvent): events that
      // failed decryption or signature verification, non-message events,
      // and empty messages are dropped instead of delivered.
      if (!decrypted) {
        this.logger.debug("Skipping undecryptable event", {
          conversationId: event.conversationId,
          eventId: event.id,
        });
        return;
      }

      const text = processableText(decrypted);
      if (text === null) {
        this.logger.debug("Skipping non-message event", {
          conversationId: event.conversationId,
          contentType: ct || decrypted.type,
          eventId: event.id,
        });
        return;
      }

      if (decrypted.verified === false) {
        this.logger.warn("Skipping unverified event", {
          conversationId: event.conversationId,
          eventId: event.id,
        });
        return;
      }

      if (!text.trim() && parsed.attachments.length === 0) {
        return;
      }

      // Read receipt before handlers run; acknowledge logs and swallows its
      // own failures, so delivery is never blocked by a receipt error.
      if (this.sendReadReceipts) {
        await this.acknowledge(threadId, parsed);
      }

      await this.chat?.handleIncomingMessage(this, threadId, parsed);
    })().catch((err) => {
      this.logger.error("Webhook event processing error", {
        conversationId: event.conversationId,
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    options?.waitUntil?.(task);

    return new Response("OK", { status: 200 });
  }

  /**
   * Bot added to a conversation: bootstrap the conversation key from the
   * KeyChange blob and post the welcome message (groups only).
   */
  private handleConversationJoin(
    event: XchatEvent,
    options?: WebhookOptions
  ): void {
    const conversationId = event.conversationId;
    this.logger.info("conversation_join", { conversationId });

    if (this._cryptoStatus === "ready") {
      const crypto = this.getCryptoEngine();
      for (const blob of [
        event.conversationKeyChangeEvent,
        event.encodedEvent,
      ]) {
        if (!blob) {
          continue;
        }
        try {
          const extracted = crypto.extractConversationKeys([blob]);
          this.mergeConversationKeys(conversationId, extracted);
        } catch {
          // Not a KeyChange blob — fine.
        }
      }
    }
    if (event.conversationToken) {
      this.conversationTokens.set(conversationId, event.conversationToken);
    }

    if (this.welcomeMessage === false || !conversationId.startsWith("g")) {
      return;
    }
    const welcome =
      this.welcomeMessage ??
      `Hey! I'm @${this._userName} — mention @${this._userName} in this group and I'll reply. Heads up: with a bot in the group, messages it can read are no longer fully private.`;

    const threadId = this.encodeThreadId({ conversationId });
    const task = this.postMessage(threadId, welcome).catch((err) => {
      this.logger.warn("Failed to post welcome message", {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    options?.waitUntil?.(task as Promise<unknown>);
  }

  /** Route a decrypted reaction event into the Chat SDK. */
  private routeReaction(
    threadId: string,
    parsed: Message<XchatRawMessage>,
    added: boolean,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }
    const decrypted = parsed.raw?.decrypted;
    const content = decrypted?.content ?? {};
    const rawEmoji = typeof content.emoji === "string" ? content.emoji : "";
    const targetMessageId = fieldOf(
      content,
      "targetMessageId",
      "target_message_id"
    );
    const senderId = decrypted?.senderId ?? parsed.raw?.event.senderId ?? "";

    const user: Author = {
      userId: senderId,
      userName: senderId,
      fullName: senderId,
      isBot: false,
      isMe: senderId === this.userId,
    };

    // A reaction targets its message by sequence id; resolve it back to the
    // message id handlers saw. Falls back to the raw sequence id when the
    // target is older than the bounded cache window.
    const targetSequenceId =
      targetMessageId == null ? "" : String(targetMessageId);
    const resolvedMessageId =
      this.messageIdBySequenceId.get(targetSequenceId) ?? targetSequenceId;

    const reactionEvent: Omit<ReactionEvent, "adapter" | "thread"> = {
      emoji: getEmoji(rawEmoji),
      rawEmoji,
      added,
      user,
      messageId: resolvedMessageId,
      threadId,
      raw: parsed.raw,
    };
    this.chat.processReaction({ ...reactionEvent, adapter: this }, options);
  }

  /**
   * Feed a polled conversation event into the Chat SDK.
   *
   * Expects an XDK camelCase event (transformKeys already applied). Decrypts
   * + verifies via chat-xdk, then awaits `chat.handleIncomingMessage` so
   * handlers (e.g. onDirectMessage) finish before this resolves.
   *
   * Returns the delivered Message, or null when the event was skipped
   * (own message, non-message, decrypt failure, empty text).
   */
  async handleIncomingEvent(
    event: XchatEvent
  ): Promise<Message<XchatRawMessage> | null> {
    if (!this.chat) {
      throw new Error("XChat adapter not initialized — call Chat.initialize()");
    }

    if (!(event.conversationId && event.encodedEvent)) {
      this.logger.debug(
        "handleIncomingEvent: missing conversationId/encodedEvent"
      );
      return null;
    }

    if (event.senderId && event.senderId === this.userId) {
      this.logger.debug("handleIncomingEvent: skip own message", {
        id: event.id,
      });
      return null;
    }

    let message: Message<XchatRawMessage>;
    try {
      message = await this.decryptAndParseEvent(event);
    } catch (err) {
      this.logger.warn("handleIncomingEvent: decrypt failed", {
        conversationId: event.conversationId,
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const decrypted = message.raw?.decrypted ?? null;
    const text = processableText(decrypted);
    if (text === null) {
      this.logger.debug("handleIncomingEvent: skip non-message", {
        type: decrypted?.type,
        contentType: contentTypeOf(decrypted?.content),
        eventId: event.id,
      });
      return null;
    }

    if (decrypted?.verified === false) {
      this.logger.warn("handleIncomingEvent: skip unverified", {
        conversationId: event.conversationId,
        eventId: event.id,
      });
      return null;
    }

    if (!text.trim() && message.attachments.length === 0) {
      return null;
    }

    const threadId = this.encodeThreadId({
      conversationId: event.conversationId,
    });

    // Read receipt before handlers run; acknowledge logs and swallows its
    // own failures, so delivery is never blocked by a receipt error.
    if (this.sendReadReceipts) {
      await this.acknowledge(threadId, message);
    }

    await this.chat.handleIncomingMessage(this, threadId, message);
    return message;
  }

  /**
   * Verify the HMAC-SHA256 signature on an incoming webhook POST.
   *
   * The `x-twitter-webhooks-signature` header contains `sha256=<base64-hash>`
   * where the hash is HMAC-SHA256(consumer_secret, raw_body).
   */
  private verifySignature(body: string, signature: string): boolean {
    if (!this.consumerSecret) {
      return false;
    }

    const expected = createHmac("sha256", this.consumerSecret)
      .update(body)
      .digest("base64");

    const expectedBuf = Buffer.from(`sha256=${expected}`);
    const actualBuf = Buffer.from(signature);

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  }

  // ── Message parsing ───────────────────────────────────────────────

  parseMessage(raw: XchatRawMessage): Message<XchatRawMessage> {
    const { event, decrypted } = raw;

    // An edit replaces its target: the backend stops serving the superseded
    // original, so the edit's replacement text IS the message text, and the
    // edit's target sequence id is what later reactions/edits/deletes must
    // reference.
    const content = decrypted?.content ?? {};
    const isEdit = contentTypeOf(content) === "edit";
    const editText = fieldOf(content, "newText", "new_text");
    const editTarget = fieldOf(content, "targetMessageId", "target_message_id");
    const text =
      isEdit && typeof editText === "string"
        ? editText
        : (decrypted?.content?.text ?? "");
    const senderId = decrypted?.senderId ?? event.senderId;
    const createdAtMsec =
      decrypted?.createdAtMsec ?? Number(event.createdAtMsec ?? 0);
    const conversationId = event.conversationId;
    const threadId = this.encodeThreadId({ conversationId });

    const messageId = decrypted?.id ?? event.id;
    const sequenceId =
      isEdit && typeof editTarget === "string" && editTarget
        ? editTarget
        : (decrypted?.sequenceId ?? event.sequenceId);

    // Track sequence ids + latest inbound context so reactions, read
    // receipts, and group quote-replies can reference this message later.
    if (sequenceId && messageId) {
      this.rememberSequenceId(messageId, sequenceId);
    }
    if (senderId && senderId !== this.userId && decrypted) {
      // Messages are parsed in whatever order they arrive — history pages come
      // newest-first — so only a message at least as recent as the stored one
      // may become the quote-reply target.
      const previous = this.lastInboundByConv.get(conversationId);
      if (!previous || (previous.createdAtMsec ?? 0) <= createdAtMsec) {
        this.lastInboundByConv.set(conversationId, {
          createdAtMsec,
          encodedEvent: event.encodedEvent || undefined,
          sequenceId,
          senderId,
          text: text || undefined,
          ttlMsec:
            typeof decrypted.ttlMsec === "number"
              ? decrypted.ttlMsec
              : Number(
                  fieldOf(decrypted, "ttlMsec", "ttl_msec") ?? Number.NaN
                ) || undefined,
        });
      }
    }

    const isMention = this.detectBotMention(decrypted, text);
    const attachments = decrypted
      ? this.attachmentsFromDecrypted(conversationId, decrypted)
      : [];

    return new Message<XchatRawMessage>({
      id: messageId ?? event.id,
      threadId,
      text,
      formatted: parseMarkdown(text),
      raw,
      author: {
        userId: senderId,
        userName: senderId,
        fullName: senderId,
        isBot: false,
        isMe: senderId === this.userId,
      },
      metadata: {
        dateSent: createdAtMsec ? new Date(createdAtMsec) : new Date(),
        edited: isEdit,
      },
      attachments,
      ...(isMention ? { isMention: true } : {}),
    });
  }

  /**
   * Mention decision from the decrypted payload.
   *
   * Structured mention entities are authoritative when present; a
   * swipe-reply to one of the bot's messages counts as a mention; otherwise
   * undefined so the Chat SDK's plain-text `@handle` fallback applies.
   */
  private detectBotMention(
    decrypted: XchatDecryptedEvent | null,
    text: string
  ): boolean | undefined {
    if (!decrypted) {
      return undefined;
    }
    const content = decrypted.content;
    const preview = replyPreviewOf(content);
    // A reply preview that failed chat-xdk's validation against its embedded
    // raw source event is forged and must not trigger the bot.
    const previewTrusted = decrypted.replyPreviewValidation !== "invalid";
    const isReplyToBot = Boolean(
      previewTrusted && preview?.senderId && preview.senderId === this.userId
    );

    const handles = mentionHandlesFromEntities(text, content?.entities);
    if (handles.length > 0) {
      const targets = new Set([
        this._userName.replace(LEADING_AT_RE, "").toLowerCase(),
        this.userId.toLowerCase(),
      ]);
      if (handles.some((h) => targets.has(h))) {
        return true;
      }
      return isReplyToBot || undefined;
    }

    return isReplyToBot || undefined;
  }

  /** Map media references on a decrypted event to Chat SDK attachments. */
  private attachmentsFromDecrypted(
    conversationId: string,
    decrypted: XchatDecryptedEvent
  ): Attachment[] {
    const keyVersion = decrypted.keyVersion;
    return extractMediaEntries(decrypted).map((entry) => ({
      type: chatAttachmentType(entry.mediaType),
      name: entry.filename,
      size: Number.isFinite(entry.filesize) ? entry.filesize : undefined,
      width: entry.width,
      height: entry.height,
      fetchData: () =>
        this.fetchMediaAttachment(conversationId, entry.hashKey, keyVersion),
    }));
  }

  /** Insert into the bounded messageId ⇄ sequenceId caches. */
  private rememberSequenceId(messageId: string, sequenceId: string): void {
    if (this.sequenceIdByMessageId.size >= SEQUENCE_CACHE_MAX) {
      const oldest = this.sequenceIdByMessageId.keys().next().value;
      if (oldest !== undefined) {
        const oldestSequenceId = this.sequenceIdByMessageId.get(oldest);
        this.sequenceIdByMessageId.delete(oldest);
        if (oldestSequenceId !== undefined) {
          this.messageIdBySequenceId.delete(oldestSequenceId);
        }
      }
    }
    this.sequenceIdByMessageId.set(messageId, sequenceId);
    this.messageIdBySequenceId.set(sequenceId, messageId);
  }

  // ── Post / Edit / Delete ──────────────────────────────────────────

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<XchatRawMessage>> {
    const { conversationId } = this.decodeThreadId(threadId);
    // Cards degrade to text plus a URL preview attachment: XChat has no
    // interactive primitives, so links become entities and the primary link
    // becomes the preview card.
    const card = cardOf(message);
    const rendered = card ? cardToXChat(card) : null;
    const text = rendered ? rendered.text : this.renderFormatted(message);
    const crypto = this.getCryptoEngine();

    this.stopTyping(conversationId);

    // Get conversation key — auto-fetch if missing
    let keyInfo = this.getLatestKey(conversationId);
    if (!keyInfo) {
      this.logger.debug(
        "No cached key, fetching conversation to extract keys",
        {
          conversationId,
        }
      );
      await this.fetchMessages(threadId, { limit: 1 });
      keyInfo = this.getLatestKey(conversationId);
      if (!keyInfo) {
        throw new Error(
          `No conversation key for ${conversationId} even after fetching.`
        );
      }
    }

    // chat-xdk canonicalizes conversation id for signatures
    if (!this.signingKeyVersion) {
      throw new Error(
        "signingKeyVersion not available. Was initialize() called?"
      );
    }

    // Upload any file/attachment payloads (encrypt-stream + 3-step upload)
    const mediaAttachments = await this.uploadOutgoingMedia(
      conversationId,
      keyInfo,
      message
    );

    // Rich-text entities (tappable links / mention pills). A message carries
    // one attachment kind, preferred in order: uploaded media, the card's URL
    // preview, then the first x.com post card referenced in the text.
    const entities = detectEntities(text);
    let attachments: AttachmentDescriptor[] | null;
    if (mediaAttachments.length > 0) {
      attachments = mediaAttachments;
    } else if (rendered?.urlCard) {
      attachments = [
        await this.urlCardAttachment(conversationId, keyInfo, rendered.urlCard),
      ];
    } else {
      attachments = extractPostAttachments(text)?.slice(0, 1) ?? null;
    }

    // Group chats reply-quote the triggering message; replies inherit its TTL.
    const inbound = this.lastInboundByConv.get(conversationId);
    const isGroup = conversationId.startsWith("g");
    const ttlMsec = inbound?.ttlMsec ?? null;

    const common = {
      senderId: this.userId,
      conversationId,
      conversationKey: keyInfo.key,
      text,
      conversationKeyVersion: keyInfo.version,
      signingKeyVersion: this.signingKeyVersion,
      entities,
      attachments,
      ttlMsec,
    };
    const payload =
      isGroup && inbound?.sequenceId
        ? this.encryptGroupReply(crypto, common, inbound)
        : crypto.encryptMessage(common);

    // The SDK mints the message id and binds it into the signature.
    const messageId = payload.messageId;

    await this.sendEncryptedPayload(conversationId, messageId, payload);
    // Age gates the first edit of this message (bounded alongside the
    // sequence-id cache).
    if (this.postedAtByMessageId.size >= SEQUENCE_CACHE_MAX) {
      const oldest = this.postedAtByMessageId.keys().next().value;
      if (oldest !== undefined) {
        this.postedAtByMessageId.delete(oldest);
      }
    }
    this.postedAtByMessageId.set(messageId, Date.now());

    // Build a synthetic raw message for the return
    const rawMessage: XchatRawMessage = {
      event: {
        id: messageId,
        conversationId,
        senderId: this.userId,
        encodedEvent: payload.encryptedContent,
        createdAtMsec: String(Date.now()),
      },
      decrypted: {
        type: "message",
        id: messageId,
        senderId: this.userId,
        conversationId,
        createdAtMsec: Date.now(),
        content: { text, contentType: "Text" },
        verified: true,
      },
    };

    return {
      id: messageId,
      raw: rawMessage,
      threadId,
    };
  }

  /**
   * Encrypt a group quote-reply, preferring the event-based form.
   *
   * Passing the raw signed event (`replyToEvent`) lets chat-xdk derive the
   * preview from the original — including the edited contents when the
   * original was edited — and embed the raw event so recipients can
   * validate the preview. When the original can't be parsed or decrypted
   * (e.g. it was encrypted under a key version we don't hold), fall back
   * to the explicit preview overrides, which skip the embedding.
   */
  private encryptGroupReply(
    crypto: ChatWithJuicebox,
    common: EncryptMessageParams,
    inbound: InboundContext
  ): SendPayload {
    if (inbound.encodedEvent) {
      try {
        return crypto.encryptReply({
          ...common,
          replyToEvent: inbound.encodedEvent,
        });
      } catch (err) {
        this.logger.debug(
          "encryptReply(replyToEvent) failed; using preview overrides",
          { error: err instanceof Error ? err.message : String(err) }
        );
      }
    }
    return crypto.encryptReply({
      ...common,
      replyToSequenceId: inbound.sequenceId,
      replyToSenderId: inbound.senderId ?? null,
      replyToText: inbound.text ?? null,
    });
  }

  /** POST an encrypted payload to the send-message endpoint. */
  private async sendEncryptedPayload(
    conversationId: string,
    messageId: string,
    payload: { encryptedContent: string; encodedEventSignature: string }
  ): Promise<void> {
    const client = this.getXdkClient();
    const apiConvId = conversationPathId(conversationId, this.userId);
    const convToken = this.conversationTokens.get(conversationId);
    const response = (await client.chat.sendMessage(apiConvId, {
      messageId,
      encodedMessageCreateEvent: payload.encryptedContent,
      encodedMessageEventSignature: payload.encodedEventSignature,
      ...(convToken ? { conversationToken: convToken } : {}),
    })) as XApiResponse<{
      encodedMessageEvent?: string;
      encoded_message_event?: string;
    }>;

    // The response echoes the stored event; its sequence id is what edits,
    // deletes, and reactions target, so capture it while it is cheap. A
    // failed parse only costs the cache entry — resolveSequenceId falls
    // back to a history fetch.
    const encodedEvent: unknown =
      response?.data?.encodedMessageEvent ??
      response?.data?.encoded_message_event;
    if (typeof encodedEvent === "string" && encodedEvent.length > 0) {
      try {
        const crypto = this.getCryptoEngine();
        const keyInfo = this.getLatestKey(conversationId);
        const event = crypto.decryptEvent(
          encodedEvent,
          keyInfo ? { [keyInfo.version]: keyInfo.key } : null,
          this.signingKeyCache.get(this.userId) ?? []
        ) as { sequenceId?: unknown; message?: { sequenceId?: unknown } };
        const sequenceId = event?.sequenceId ?? event?.message?.sequenceId;
        if (typeof sequenceId === "string" && sequenceId.length > 0) {
          this.rememberSequenceId(messageId, sequenceId);
        }
      } catch {
        // Undecodable echo — the id stays resolvable via fetchMessages.
      }
    }
  }

  /**
   * Resolve a message's sequence id (the identifier edits, deletes, and
   * reactions target). Falls back to replaying recent history, which
   * repopulates the cache through parseMessage.
   */
  private async resolveSequenceId(
    threadId: string,
    messageId: string
  ): Promise<string> {
    const cached = this.sequenceIdByMessageId.get(messageId);
    if (cached) {
      return cached;
    }
    await this.fetchMessages(threadId, { limit: 50 });
    const fetched = this.sequenceIdByMessageId.get(messageId);
    if (!fetched) {
      throw new Error(
        `No sequence id known for message ${messageId}; it may be older than the last 50 events.`
      );
    }
    return fetched;
  }

  /**
   * Encrypt-stream + upload every file / data-bearing attachment on an
   * outgoing message, returning media attachment descriptors.
   */
  private async uploadOutgoingMedia(
    conversationId: string,
    keyInfo: { key: Uint8Array; version: string },
    message: AdapterPostableMessage
  ): Promise<AttachmentDescriptor[]> {
    if (typeof message === "string") {
      return [];
    }
    const files: FileUpload[] = Array.isArray(
      (message as { files?: FileUpload[] }).files
    )
      ? ((message as { files?: FileUpload[] }).files as FileUpload[])
      : [];
    const withData: Attachment[] = (
      Array.isArray((message as { attachments?: Attachment[] }).attachments)
        ? ((message as { attachments?: Attachment[] })
            .attachments as Attachment[])
        : []
    ).filter((a) => a.data || a.fetchData);

    const descriptors: AttachmentDescriptor[] = [];
    for (const file of files) {
      const bytes = await toBytes(file.data);
      descriptors.push(
        await this.encryptAndUploadMedia(conversationId, keyInfo, bytes, {
          filename: file.filename,
          mimeType: file.mimeType,
        })
      );
    }
    for (const att of withData) {
      const data = att.data ?? (await att.fetchData?.());
      if (!data) {
        continue;
      }
      const bytes = await toBytes(data);
      descriptors.push(
        await this.encryptAndUploadMedia(conversationId, keyInfo, bytes, {
          filename: att.name ?? "attachment",
          mimeType: att.mimeType,
          width: att.width,
          height: att.height,
        })
      );
    }
    return descriptors;
  }

  /**
   * Edit a previously sent message. The edit is an encrypted event carrying
   * the target's sequence id plus the replacement text and entities; it is
   * sent through the same channel as a regular message and recipients apply
   * it to the original in place. Only the bot's own text messages are
   * editable.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<XchatRawMessage>> {
    const { conversationId } = this.decodeThreadId(threadId);
    const crypto = this.getCryptoEngine();
    if (!this.signingKeyVersion) {
      throw new Error(
        "signingKeyVersion not available. Was initialize() called?"
      );
    }
    const sequenceId = await this.resolveSequenceId(threadId, messageId);
    const keyInfo = this.getLatestKey(conversationId);
    if (!keyInfo) {
      throw new Error(`No conversation key for ${conversationId}`);
    }

    // Hold the edit until the original is old enough to have been delivered:
    // an edit that reaches a client before the original leaves the message
    // permanently invisible there (the backend stops serving superseded
    // originals, so the client can never backfill the edit's target).
    const postedAt = this.postedAtByMessageId.get(messageId);
    if (postedAt !== undefined && this.editSafetyDelayMs > 0) {
      const remaining = this.editSafetyDelayMs - (Date.now() - postedAt);
      if (remaining > 0) {
        this.logger.debug("Delaying first edit until the original settles", {
          messageId,
          remainingMs: remaining,
        });
        await new Promise((resolveWait) => setTimeout(resolveWait, remaining));
      }
    }

    const text = this.renderFormatted(message);
    const payload = crypto.encryptEdit({
      senderId: this.userId,
      conversationId,
      targetMessageSequenceId: sequenceId,
      updatedText: text,
      entities: detectEntities(text),
      conversationKey: keyInfo.key,
      conversationKeyVersion: keyInfo.version,
      signingKeyVersion: this.signingKeyVersion,
    });
    await this.sendEncryptedPayload(conversationId, payload.messageId, payload);

    // The edit event has its own id; the returned message keeps the edited
    // message's id so callers can keep referencing (and re-editing) it.
    return {
      id: messageId,
      threadId,
      raw: {
        event: {
          id: payload.messageId,
          conversationId,
          senderId: this.userId,
          encodedEvent: payload.encryptedContent,
          createdAtMsec: String(Date.now()),
        },
        decrypted: {
          type: "message",
          id: messageId,
          senderId: this.userId,
          conversationId,
          createdAtMsec: Date.now(),
          content: { text, contentType: "Text" },
          verified: true,
        },
      },
    };
  }

  /**
   * Delete a message for every participant. The signed delete action is
   * prepared locally (recipients verify it) and submitted with the request;
   * the API accepts delete-for-all only for the bot's own messages.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);
    const crypto = this.getCryptoEngine();
    if (!this.signingKeyVersion) {
      throw new Error(
        "signingKeyVersion not available. Was initialize() called?"
      );
    }
    const sequenceId = await this.resolveSequenceId(threadId, messageId);
    const signature = crypto.prepareMessageDelete({
      senderId: this.userId,
      conversationId,
      sequenceIds: [sequenceId],
      deleteForAll: true,
      signingKeyVersion: this.signingKeyVersion,
    });

    const client = this.getXdkClient();
    await client.chat.deleteMessages(dashConversationId(conversationId), {
      sequenceIds: [sequenceId],
      deleteMessageAction: "delete_for_all",
      actionSignatures: [
        {
          messageId: signature.messageId,
          encodedMessageEventDetail: signature.encodedMessageEventDetail,
          ...(signature.signaturePayload
            ? { signaturePayload: signature.signaturePayload }
            : {}),
          messageEventSignature: {
            signature: signature.signature,
            publicKeyVersion: signature.publicKeyVersion,
            signatureVersion: signature.signatureVersion,
            signingPublicKey: crypto.getPublicKeys().signing,
          },
        },
      ],
    });
    this.logger.info("Deleted message", { conversationId, sequenceId });
  }

  // ── Reactions ─────────────────────────────────────────────────────

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    await this.sendReaction(threadId, messageId, emoji, true);
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    await this.sendReaction(threadId, messageId, emoji, false);
  }

  private async sendReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
    add: boolean
  ): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);
    // Reactions are best-effort: when the sequence id is neither cached nor
    // recoverable from recent history, warn and skip instead of throwing.
    let sequenceId: string;
    try {
      sequenceId = await this.resolveSequenceId(threadId, messageId);
    } catch (err) {
      this.logger.warn("Cannot react: no sequence id for message", {
        threadId,
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const crypto = this.getCryptoEngine();
    const keyInfo = this.getLatestKey(conversationId);
    if (!keyInfo) {
      throw new Error(`No conversation key for ${conversationId}`);
    }
    if (!this.signingKeyVersion) {
      throw new Error(
        "signingKeyVersion not available. Was initialize() called?"
      );
    }

    // Resolve to a unicode emoji (XChat reactions are unicode). The shared
    // resolver's Google Chat profile is its plain-unicode output, so it is
    // the right conversion here despite the name.
    const unicodeEmoji = defaultEmojiResolver.toGChat(emoji);

    const params = {
      senderId: this.userId,
      conversationId,
      conversationKey: keyInfo.key,
      targetMessageSequenceId: sequenceId,
      emoji: unicodeEmoji,
      conversationKeyVersion: keyInfo.version,
      signingKeyVersion: this.signingKeyVersion,
    };
    const payload = add
      ? crypto.encryptAddReaction(params)
      : crypto.encryptRemoveReaction(params);

    // The SDK mints the reaction's message id and binds it into the signature.
    await this.sendEncryptedPayload(conversationId, payload.messageId, payload);
  }

  // ── Fetch messages ────────────────────────────────────────────────

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<XchatRawMessage>> {
    const { conversationId } = this.decodeThreadId(threadId);
    const client = this.getXdkClient();
    const crypto = this.getCryptoEngine();

    // Conversation events come from GET /2/chat/conversations/{id}/events
    // (GET /2/chat/conversations/{id} returns only conversation metadata).
    // Conversation key (KeyChange) events arrive inline in data[] — not in
    // meta — so we hand the whole batch to decryptEvents(), which extracts
    // keys and decrypts messages in a single pass.
    const apiConvId = conversationPathId(conversationId, this.userId);
    const response = (await client.chat.getConversationEvents(apiConvId, {
      maxResults: options?.limit ?? 50,
      paginationToken: options?.cursor,
      chatMessageEventFields: [
        ...MESSAGE_EVENT_FIELDS,
      ] as unknown as MessageEventFields,
    })) as unknown as ConversationEventsResponse;

    const rawEvents = response?.data ?? [];
    const nextCursor = response?.meta?.nextToken ?? response?.meta?.next_token;

    // Cache keys/tokens under the conversationId on events (colon form), not
    // the URL/list form — that is the only id decrypt paths will look up.
    const cacheConvId =
      rawEvents.find((e) => e.conversationId)?.conversationId ?? conversationId;

    // Collect encoded events, cache tokens, and map back to raw metadata.
    const encodedEvents: string[] = [];
    const b64ToRaw = new Map<string, Partial<XchatEvent>>();
    const senderIds = new Set<string>();
    for (const evt of rawEvents) {
      if (evt.conversationToken) {
        this.conversationTokens.set(
          evt.conversationId ?? cacheConvId,
          evt.conversationToken
        );
      }
      if (evt.senderId) {
        senderIds.add(evt.senderId);
      }
      const encodedEvent = evt.encodedEvent ?? "";
      if (encodedEvent) {
        encodedEvents.push(encodedEvent);
        b64ToRaw.set(encodedEvent, evt);
      }
    }

    if (encodedEvents.length === 0) {
      return { messages: [], nextCursor };
    }

    // Fetch signing keys for everyone involved so decryptEvents can verify
    // message signatures (verification is best-effort — missing keys just
    // leave messages unverified rather than failing decryption).
    const involvedUserIds = new Set<string>([
      ...senderIds,
      this.userId,
      ...this.participantsFromConversationId(cacheConvId),
    ]);
    const signingKeys = await this.getSigningKeysForUsers([...involvedUserIds]);

    // Batch decrypt — extracts conversation keys from KeyChange events,
    // matches signing keys by userId, and decrypts every message in one pass.
    let result: ReturnType<typeof crypto.decryptEvents>;
    try {
      result = crypto.decryptEvents(encodedEvents, signingKeys);
    } catch (err) {
      this.logger.warn("decryptEvents failed", {
        conversationId: cacheConvId,
        error: err,
      });
      return { messages: [], nextCursor };
    }

    // Merge extracted conversation keys into the cache (used for sending).
    this.mergeConversationKeys(cacheConvId, result.conversationKeys);

    // Under the SDK's hardened default (reject_unverified = true) any event
    // whose signature can't be verified lands here instead of in messages.
    // Surface it so silent drops are debuggable.
    const errorCount = Object.keys(result.errors).length;
    if (errorCount > 0) {
      this.logger.debug("decryptEvents reported errors", {
        conversationId: cacheConvId,
        errorCount,
        errors: result.errors,
      });
    }

    const messages: Message<XchatRawMessage>[] = [];
    for (const dm of result.messages) {
      const event = dm.event;
      if (
        !event ||
        processableText(event as unknown as XchatDecryptedEvent) === null
      ) {
        continue;
      }

      const raw = dm.originalB64 ? b64ToRaw.get(dm.originalB64) : undefined;
      // The decrypted event's meta carries epoch millis; the API event carries
      // an ISO-8601 created_at instead.
      const rawCreatedAtMsec =
        raw?.createdAtMsec ??
        (raw?.createdAt ? Date.parse(raw.createdAt) : Number.NaN);
      const createdAtMsec =
        event.createdAtMsec ??
        (Number.isFinite(Number(rawCreatedAtMsec))
          ? rawCreatedAtMsec
          : undefined);
      const rawMessage: XchatRawMessage = {
        event: {
          id: event.id ?? raw?.id ?? "",
          conversationId,
          senderId: event.senderId ?? raw?.senderId ?? "",
          encodedEvent: dm.originalB64 ?? raw?.encodedEvent ?? "",
          createdAtMsec:
            createdAtMsec == null ? undefined : String(createdAtMsec),
          conversationToken: raw?.conversationToken,
          messageEventSignature: raw?.messageEventSignature,
          sequenceId: event.sequenceId ?? raw?.sequenceId,
        },
        decrypted: event as XchatDecryptedEvent,
      };
      messages.push(this.parseMessage(rawMessage));
    }

    // Sort chronologically (oldest first)
    messages.sort(
      (a, b) => a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime()
    );

    return { messages, nextCursor };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: threadId,
      isDM: !conversationId.startsWith("g"),
      metadata: { conversationId },
    };
  }

  // ── Format rendering ──────────────────────────────────────────────

  renderFormatted(content: FormattedContent | AdapterPostableMessage): string {
    if (typeof content === "string") {
      return content;
    }
    if ("type" in content && content.type === "root") {
      return this.formatConverter.fromAst(content as FormattedContent);
    }
    return this.formatConverter.renderPostable(
      content as AdapterPostableMessage
    );
  }

  // ── Typing indicator ──────────────────────────────────────────────

  /**
   * Send a typing indicator and keep re-sending it every few seconds until
   * the next postMessage in this conversation (or a safety timeout). XChat
   * typing pills expire quickly, so a single POST is invisible during a
   * longer generation.
   */
  async startTyping(threadId: string): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);
    this.stopTyping(conversationId);
    await this.sendTypingOnce(conversationId);

    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > TYPING_MAX_MS) {
        this.stopTyping(conversationId);
        return;
      }
      this.sendTypingOnce(conversationId).catch(() => undefined);
    }, TYPING_INTERVAL_MS);
    timer.unref?.();
    this.typingTimers.set(conversationId, timer);
  }

  private async sendTypingOnce(conversationId: string): Promise<void> {
    try {
      const client = this.getXdkClient();
      const apiConvId = conversationPathId(conversationId, this.userId);
      await client.chat.sendTypingIndicator(apiConvId);
    } catch (err) {
      this.logger.warn("Failed to send typing indicator", { error: err });
    }
  }

  private stopTyping(conversationId: string): void {
    const timer = this.typingTimers.get(conversationId);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(conversationId);
    }
  }

  // ── Read receipts ─────────────────────────────────────────────────

  /**
   * Send a read receipt (seen-until watermark) for an inbound message.
   *
   * Called automatically for each delivered inbound message when
   * `sendReadReceipts` is enabled (the default).
   */
  async markAsRead(
    threadId: string,
    messageIdOrMessage: string | Message<XchatRawMessage>,
    message?: Message<XchatRawMessage>
  ): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);
    const target =
      typeof messageIdOrMessage === "string" ? message : messageIdOrMessage;
    const messageId =
      typeof messageIdOrMessage === "string"
        ? messageIdOrMessage
        : messageIdOrMessage.id;
    const raw = target?.raw;
    let sequenceId =
      raw?.decrypted?.sequenceId ??
      raw?.event?.sequenceId ??
      this.sequenceIdByMessageId.get(messageId) ??
      "";
    const client = this.getXdkClient();
    const apiConvId = conversationPathId(conversationId, this.userId);

    if (!sequenceId && typeof messageIdOrMessage === "string") {
      sequenceId = target
        ? await this.resolveSequenceId(threadId, messageId).catch(() => "")
        : await this.resolveSequenceId(threadId, messageId);
    }

    // Fallback: mark read up to the latest event in the conversation.
    if (!sequenceId) {
      const response = (await client.chat.getConversationEvents(apiConvId, {
        maxResults: 1,
        chatMessageEventFields: [
          ...MESSAGE_EVENT_FIELDS,
        ] as unknown as MessageEventFields,
      })) as unknown as ConversationEventsResponse;
      const latest = response?.data?.[0];
      // Event ids use a different namespace. Only a real sequence id is a
      // valid read watermark, so fail when the latest event lacks one.
      sequenceId = latest?.sequenceId ?? "";
      if (!sequenceId) {
        throw new ValidationError(
          "xchat",
          `No sequence id known for message ${messageId}`
        );
      }
    }

    const response = await client.chat.markConversationRead(apiConvId, {
      seenUntilSequenceId: sequenceId,
    });
    if (!response.data?.success) {
      throw new AdapterError("XChat mark as read failed", "xchat");
    }
    this.logger.debug("Read receipt sent", {
      conversationId: apiConvId,
      sequenceId,
    });
  }

  private async acknowledge(
    threadId: string,
    message: Message<XchatRawMessage>
  ): Promise<void> {
    try {
      await this.markAsRead(threadId, message);
    } catch (err) {
      this.logger.warn("Failed to send read receipt", {
        threadId,
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── DM detection ──────────────────────────────────────────────────

  isDM(threadId: string): boolean {
    const { conversationId } = this.decodeThreadId(threadId);
    return !conversationId.startsWith("g");
  }

  // ── Media (encrypted download / upload) ──────────────────────────

  /**
   * Download and decrypt a media attachment.
   *
   * Media bytes are secretstream-encrypted under a conversation key;
   * `keyVersion` selects the matching cached key (latest when omitted).
   */
  async fetchMediaAttachment(
    conversationId: string,
    mediaHashKey: string,
    keyVersion?: string
  ): Promise<Buffer> {
    const crypto = this.getCryptoEngine();

    let keyResult = this.conversationKeys.get(conversationId);
    if (!keyResult) {
      await this.fetchMessages(this.encodeThreadId({ conversationId }), {
        limit: 1,
      });
      keyResult = this.conversationKeys.get(conversationId);
    }
    const key =
      (keyVersion ? keyResult?.keys[keyVersion] : undefined) ??
      (keyResult?.latestVersion
        ? keyResult.keys[keyResult.latestVersion]
        : undefined);
    if (!key) {
      throw new Error(`No conversation key for ${conversationId}`);
    }

    const client = this.getXdkClient();
    // The media routes accept only the dash-joined participant pair (or the
    // g-prefixed group id) — not the bare peer id the other chat routes take,
    // and not the colon form carried in events.
    const encrypted = new Uint8Array(
      await client.chat.mediaDownload(
        dashConversationId(conversationId),
        mediaHashKey
      )
    );
    const plaintext = crypto.decryptStream(encrypted, key);
    return Buffer.from(plaintext);
  }

  /**
   * Encrypt-stream a payload and run the 3-step upload (initialize / append /
   * finalize), returning the stored blob's media hash key.
   */
  private async uploadEncryptedBlob(
    conversationId: string,
    keyInfo: { key: Uint8Array; version: string },
    bytes: Uint8Array
  ): Promise<{ mediaHashKey: string; encryptedBytes: number }> {
    const crypto = this.getCryptoEngine();
    const client = this.getXdkClient();
    const encrypted = crypto.encryptStream(bytes, keyInfo.key);

    // Media routes accept only the dash-joined participant pair (or the
    // g-prefixed group id), never the colon-joined internal form.
    const apiConversationId = dashConversationId(conversationId);

    const initBody = await client.chat.mediaUploadInitialize({
      conversationId: apiConversationId,
      totalBytes: encrypted.length,
    });
    const sessionId = initBody.data?.sessionId;
    const mediaHashKey = initBody.data?.mediaHashKey;
    if (!(sessionId && mediaHashKey)) {
      throw new Error("Media upload initialize returned no session");
    }

    let segmentIndex = 0;
    for (
      let offset = 0;
      offset < encrypted.length;
      offset += UPLOAD_CHUNK_BYTES
    ) {
      const chunk = encrypted.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
      await client.chat.mediaUploadAppend(sessionId, {
        conversationId: apiConversationId,
        mediaHashKey,
        segmentIndex,
        media: Buffer.from(chunk).toString("base64"),
      });
      segmentIndex += 1;
    }

    await client.chat.mediaUploadFinalize(sessionId, {
      conversationId: apiConversationId,
      mediaHashKey,
      numParts: String(segmentIndex),
    });

    return { mediaHashKey, encryptedBytes: encrypted.length };
  }

  private async encryptAndUploadMedia(
    conversationId: string,
    keyInfo: { key: Uint8Array; version: string },
    bytes: Uint8Array,
    meta: {
      filename: string;
      mimeType?: string;
      width?: number;
      height?: number;
    }
  ): Promise<AttachmentDescriptor> {
    const mimeType = meta.mimeType ?? detectMimeType(bytes) ?? "";
    const { mediaHashKey } = await this.uploadEncryptedBlob(
      conversationId,
      keyInfo,
      bytes
    );

    // Dimensions from the plaintext; videos fall back to a 16:9 default so
    // the client renders a usable preview card.
    const isVideo = mimeType.startsWith("video/");
    const dims = detectImageDimensions(bytes);
    const width = meta.width ?? dims?.width ?? (isVideo ? 1280 : 1024);
    const height = meta.height ?? dims?.height ?? (isVideo ? 720 : 1024);
    const mediaType = outgoingMediaType(mimeType);

    this.logger.debug("Media uploaded", {
      conversationId,
      mediaHashKey: mediaHashKey.slice(0, 16),
      bytes: bytes.length,
      mimeType,
    });

    return {
      attachment_type: "media",
      media_hash_key: mediaHashKey,
      width,
      height,
      filesize_bytes: bytes.length,
      filename: meta.filename,
      ...(mediaType === undefined ? {} : { media_type: mediaType }),
    };
  }

  /**
   * Build a URL preview attachment from a card spec, encrypting and
   * uploading the banner image when the spec carries one. The banner's
   * hash key, encrypted size, and filename are all required on the wire —
   * receiving clients silently discard the image when any is missing — so
   * a failed banner fetch degrades to a card without an image.
   */
  private async urlCardAttachment(
    conversationId: string,
    keyInfo: { key: Uint8Array; version: string },
    spec: XchatUrlCardSpec
  ): Promise<AttachmentDescriptor> {
    let bannerImage: UrlAttachmentImageDescriptor | undefined;
    if (spec.imageUrl) {
      try {
        const response = await fetch(spec.imageUrl);
        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const { mediaHashKey, encryptedBytes } =
            await this.uploadEncryptedBlob(conversationId, keyInfo, bytes);
          const dims = detectImageDimensions(bytes);
          const filename =
            spec.imageUrl.split("/").pop()?.split("?")[0] || "banner";
          bannerImage = {
            media_hash_key: mediaHashKey,
            filesize_bytes: encryptedBytes,
            filename,
            ...(dims ? { width: dims.width, height: dims.height } : {}),
          };
        }
      } catch (err) {
        this.logger.warn("URL card banner upload failed; sending without it", {
          imageUrl: spec.imageUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      attachment_type: "url",
      url: spec.url,
      ...(spec.displayTitle ? { display_title: spec.displayTitle } : {}),
      ...(bannerImage ? { banner_image: bannerImage } : {}),
    };
  }

  // ── Open a DM ─────────────────────────────────────────────────────

  /**
   * Start (or reopen) a 1:1 conversation with a user, returning its thread
   * id. XChat 1:1 ids are derived from the participant pair, so an existing
   * conversation is reused: when a conversation key is already held (or
   * fetchable), no key exchange happens. Otherwise a fresh conversation key
   * is prepared, encrypted to both participants' identity keys, and posted
   * to initialize the conversation. Requires the recipient to have encrypted
   * chat set up; the server also requires the recipient to trust the bot
   * (e.g. follow it) before the first message is accepted.
   */
  async openDM(userId: string): Promise<string> {
    if (!NUMERIC_USER_ID.test(userId)) {
      throw new Error(
        `openDM requires a numeric X user id (got "${userId}"). ` +
          "Handles like @alice must be resolved to a user id first."
      );
    }
    const crypto = this.getCryptoEngine();
    const client = this.getXdkClient();

    const canonicalId = [userId, this.userId]
      .map(BigInt)
      .sort((a, b) => {
        if (a === b) {
          return 0;
        }
        return a < b ? -1 : 1;
      })
      .map(String)
      .join(":");
    const threadId = this.encodeThreadId({ conversationId: canonicalId });
    if (this.getLatestKey(canonicalId)) {
      return threadId;
    }
    try {
      await this.fetchMessages(threadId, { limit: 50 });
    } catch {
      // No conversation yet — fall through to the key exchange.
    }
    if (this.getLatestKey(canonicalId)) {
      return threadId;
    }

    const signingEntries = await this.getSigningKeysForUsers([
      this.userId,
      userId,
    ]);
    const publicKeys: PublicKeyInput[] = signingEntries.map((entry) => ({
      userId: entry.userId,
      publicKey: entry.identityPublicKey,
      keyVersion: entry.publicKeyVersion,
    }));
    if (!publicKeys.some((key) => key.userId === userId)) {
      throw new Error(
        `Cannot open DM: user ${userId} has no registered chat keys (encrypted chat not set up).`
      );
    }

    const prepared = crypto.prepareConversationKeyChange({ publicKeys });
    const signingPublicKey = crypto.getPublicKeys().signing;
    await client.chat.addConversationKeys(
      dashConversationId(prepared.conversationId),
      {
        conversationKeyVersion: prepared.conversationKeyVersion,
        conversationParticipantKeys: prepared.participantKeys.map((key) => ({
          userId: key.userId,
          encryptedConversationKey: key.encryptedKey,
          publicKeyVersion: key.publicKeyVersion,
        })),
        actionSignatures: prepared.actionSignatures.map((sig) => ({
          messageId: sig.messageId,
          encodedMessageEventDetail: sig.encodedMessageEventDetail,
          ...(sig.signaturePayload
            ? { signaturePayload: sig.signaturePayload }
            : {}),
          messageEventSignature: {
            signature: sig.signature,
            signatureVersion: sig.signatureVersion,
            publicKeyVersion: sig.publicKeyVersion,
            signingPublicKey,
          },
        })),
      }
    );

    this.mergeConversationKeys(prepared.conversationId, {
      keys: { [prepared.conversationKeyVersion]: prepared.conversationKey },
      latestVersion: prepared.conversationKeyVersion,
    });
    this.logger.info("Opened DM conversation", {
      conversationId: prepared.conversationId,
      keyVersion: prepared.conversationKeyVersion,
    });
    return this.encodeThreadId({ conversationId: prepared.conversationId });
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private getXdkClient(): InstanceType<typeof Client> {
    if (!this.xdkClient) {
      throw new Error(
        "XChat adapter not initialized. Call initialize() first."
      );
    }
    return this.xdkClient;
  }

  private getCryptoEngine(): ChatWithJuicebox {
    if (!this.cryptoEngine || this._cryptoStatus !== "ready") {
      throw new Error(
        this._cryptoStatus === "locked"
          ? "XChat adapter is locked. Call adapter.unlock(pin) first."
          : "XChat crypto not initialized. Call initialize() first."
      );
    }
    return this.cryptoEngine;
  }

  /**
   * Derive the candidate participant user IDs from a conversation ID.
   *
   * 1:1 conversation IDs encode both participants as `{userId1}-{userId2}`
   * (or `{userId1}:{userId2}`). Group conversation IDs are opaque (`g...`),
   * so we return nothing and rely on the sender IDs seen in events.
   */
  private participantsFromConversationId(conversationId: string): string[] {
    if (conversationId.startsWith("g")) {
      return [];
    }
    return conversationId
      .split(CONVERSATION_ID_SEPARATOR)
      .filter((part) => NUMERIC_USER_ID.test(part));
  }

  /**
   * Fetch (and cache) signing keys for the given users from the X API.
   *
   * Returns a flat array of SigningKeyEntry (one per user per key version)
   * suitable for `decryptEvents` / `decryptEvent`. Failures are swallowed —
   * a missing signing key only means messages from that user stay unverified.
   * Failed lookups are not cached, so a transient API error is retried on
   * the next call instead of leaving the user permanently unverifiable.
   */
  private async getSigningKeysForUsers(
    userIds: string[]
  ): Promise<SigningKeyEntry[]> {
    const client = this.getXdkClient();
    const missing = userIds.filter((id) => id && !this.signingKeyCache.has(id));

    await Promise.all(
      missing.map(async (userId) => {
        try {
          const response = (await client.users.getPublicKey(userId, {
            publicKeyFields: [...SIGNING_KEY_FIELDS],
          })) as XApiResponse<PublicKeyData[] | PublicKeyData>;
          const data = response?.data;
          let keys: PublicKeyData[] = [];
          if (Array.isArray(data)) {
            keys = data;
          } else if (data) {
            keys = [data];
          }

          const entries: SigningKeyEntry[] = [];
          for (const key of keys) {
            const publicKeyVersion = publicKeyVersionOf(key);
            if (
              publicKeyVersion &&
              key.signingPublicKey &&
              key.publicKey &&
              key.identityPublicKeySignature
            ) {
              entries.push({
                userId,
                publicKeyVersion,
                publicKey: key.signingPublicKey,
                identityPublicKey: key.publicKey,
                identityPublicKeySignature: key.identityPublicKeySignature,
              });
            }
          }
          this.signingKeyCache.set(userId, entries);
        } catch (err) {
          // Deliberately not cached: the next lookup retries the fetch.
          this.logger.debug("Failed to fetch signing keys", {
            userId,
            error: err,
          });
        }
      })
    );

    const all: SigningKeyEntry[] = [];
    for (const id of userIds) {
      const cached = this.signingKeyCache.get(id);
      if (cached) {
        all.push(...cached);
      }
    }
    return all;
  }

  /**
   * Merge freshly extracted conversation keys into the cache for a conversation.
   */
  private mergeConversationKeys(
    conversationId: string,
    extracted: ConversationKeyResult
  ): void {
    if (!extracted || Object.keys(extracted.keys).length === 0) {
      return;
    }
    const existing = this.conversationKeys.get(conversationId);
    if (existing) {
      for (const [version, key] of Object.entries(extracted.keys)) {
        existing.keys[version] = key;
      }
      if (extracted.latestVersion) {
        existing.latestVersion = extracted.latestVersion;
      }
    } else {
      this.conversationKeys.set(conversationId, {
        keys: { ...extracted.keys },
        latestVersion: extracted.latestVersion,
      });
    }
  }

  /**
   * Decrypt a single event, returning a XchatRawMessage.
   * Falls back gracefully if decryption fails (returns null decrypted).
   */
  private tryDecryptEvent(
    conversationId: string,
    event: XchatEvent,
    signingKeys: SigningKeyEntry[] = []
  ): XchatRawMessage {
    const crypto = this.getCryptoEngine();
    const keyResult = this.conversationKeys.get(conversationId);

    if (!(keyResult && event.encodedEvent)) {
      return { event, decrypted: null };
    }

    try {
      const decrypted = crypto.decryptEvent(
        event.encodedEvent,
        keyResult.keys,
        signingKeys
      ) as XchatDecryptedEvent;
      return { event, decrypted };
    } catch {
      this.logger.debug("Failed to decrypt event", {
        conversationId,
        eventId: event.id,
      });
      return { event, decrypted: null };
    }
  }

  /**
   * Decrypt an XAA or polled API event (key extraction from
   * conversation_key_change_event, encrypted_conversation_key, or a
   * KeyChange encoded as encoded_event), then parse into a Message.
   *
   * Falls back to decryptEvents when single-event decrypt fails — the
   * conversation-events poll path often embeds key material that way.
   */
  private async decryptAndParseEvent(
    event: XchatEvent
  ): Promise<Message<XchatRawMessage>> {
    const crypto = this.getCryptoEngine();
    const conversationId = event.conversationId;

    // Extract conversation key if a key change event is present
    if (event.conversationKeyChangeEvent) {
      const extracted = crypto.extractConversationKeys([
        event.conversationKeyChangeEvent,
      ]);
      this.mergeConversationKeys(conversationId, extracted);
    }

    // Poll path: KeyChange may arrive as the encoded_event itself
    if (event.encodedEvent) {
      try {
        const extracted = crypto.extractConversationKeys([event.encodedEvent]);
        this.mergeConversationKeys(conversationId, extracted);
      } catch {
        // Not a key-change event — fine.
      }
    }

    // Also try the encryptedConversationKey field (XAA webhook path)
    if (
      event.encryptedConversationKey &&
      event.conversationKeyVersion &&
      !this.conversationKeys.get(conversationId)?.keys[
        event.conversationKeyVersion
      ]
    ) {
      try {
        const rawKey = crypto.decryptConversationKey(
          event.encryptedConversationKey
        );
        const existing = this.conversationKeys.get(conversationId);
        if (existing) {
          existing.keys[event.conversationKeyVersion] = rawKey;
          existing.latestVersion = event.conversationKeyVersion;
        } else {
          this.conversationKeys.set(conversationId, {
            keys: { [event.conversationKeyVersion]: rawKey },
            latestVersion: event.conversationKeyVersion,
          });
        }
      } catch {
        this.logger.debug("Failed to decrypt conversation key", {
          conversationId,
        });
      }
    }

    if (event.conversationToken) {
      this.conversationTokens.set(conversationId, event.conversationToken);
    }

    // Fetch signing keys for the sender so the message signature can be verified.
    const signingKeys = await this.getSigningKeysForUsers([
      event.senderId,
      this.userId,
    ]);

    const raw = this.tryDecryptEvent(conversationId, event, signingKeys);
    if (raw.decrypted) {
      return this.parseMessage(raw);
    }

    // Fallback: batch decryptEvents (handles signed poll events + key cache)
    try {
      const result = crypto.decryptEvents([event.encodedEvent], signingKeys);
      this.mergeConversationKeys(conversationId, result.conversationKeys);

      const dm = result.messages.find((m) => m.event?.type === "message");
      if (dm?.event) {
        return this.parseMessage({
          event,
          decrypted: dm.event as unknown as XchatDecryptedEvent,
        });
      }
    } catch {
      // Fall through to undecrypted message
    }

    return this.parseMessage({ event, decrypted: null });
  }

  /**
   * Get the latest conversation key for a conversation.
   */
  private getLatestKey(
    conversationId: string
  ): { key: Uint8Array; version: string } | null {
    const result = this.conversationKeys.get(conversationId);
    if (!result?.latestVersion) {
      return null;
    }
    const key = result.keys[result.latestVersion];
    if (!key) {
      return null;
    }
    return { key, version: result.latestVersion };
  }
}

// ── Factory function ──────────────────────────────────────────────────

/**
 * Create an XChat adapter with configuration from env vars or explicit config.
 *
 * **Required** (via config or env vars):
 * - `botToken` / `accessToken` / `XCHAT_BOT_TOKEN` / `X_ACCESS_TOKEN`: OAuth2 access token
 *
 * **Optional:**
 * - `pin` / `XCHAT_PIN`: Juicebox PIN; when set, initialize() auto-unlocks
 * - `signingKeyVersion` / `X_SIGNING_KEY_VERSION`: Override for signing key version.
 *   When omitted, fetched automatically from the X API during initialize().
 * - `userName` / `X_BOT_USERNAME`: Override @handle. When omitted, initialize()
 *   resolves it from GET /2/users/me.
 * - `verifySignatures` / `X_VERIFY_SIGNATURES`: Require verifiable signatures
 *   on incoming messages (default true). Set false to decrypt unverifiable
 *   messages instead of dropping them.
 */
export function createXchatAdapter(config?: XchatAdapterConfig): XchatAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("xchat");

  const accessToken =
    config?.botToken ??
    config?.accessToken ??
    process.env.XCHAT_BOT_TOKEN ??
    process.env.X_ACCESS_TOKEN;
  if (!accessToken) {
    throw new ValidationError(
      "xchat",
      "botToken/accessToken is required. Set XCHAT_BOT_TOKEN or X_ACCESS_TOKEN, or provide botToken/accessToken in config."
    );
  }

  const consumerSecret =
    config?.consumerSecret ?? process.env.X_CONSUMER_SECRET ?? undefined;
  const disableWebhookVerification =
    config?.disableWebhookVerification ??
    process.env.X_DISABLE_WEBHOOK_VERIFICATION === "true";

  const pin = config?.pin ?? process.env.XCHAT_PIN ?? undefined;

  const signingKeyVersion =
    config?.signingKeyVersion ?? process.env.X_SIGNING_KEY_VERSION ?? undefined;

  const verifySignatures =
    config?.verifySignatures ?? process.env.X_VERIFY_SIGNATURES !== "false";

  // Prefer explicit config; env override; otherwise initialize() fills from /2/users/me
  const userName = config?.userName ?? process.env.X_BOT_USERNAME;

  return new XchatAdapter({
    accessToken,
    apiBaseUrl: config?.apiBaseUrl,
    apiHeaders: config?.apiHeaders,
    consumerSecret,
    disableWebhookVerification,
    editSafetyDelayMs: config?.editSafetyDelayMs,
    logger,
    pin,
    signingKeyVersion,
    verifySignatures,
    userName,
    welcomeMessage: config?.welcomeMessage,
  });
}
