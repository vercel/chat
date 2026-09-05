import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterError,
  type AttachmentTransport,
  cardToFallbackText,
  downloadAttachment,
  extractCard,
  extractFiles,
  extractPostableAttachments,
  NetworkError,
  type PlatformName,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  Logger,
  RawMessage,
  ReactionEvent,
  StateAdapter,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  getEmoji,
  Message,
  MessageHistoryCache,
} from "chat";
import {
  cardLinkButtonLines,
  cardToWhatsApp,
  decodeWhatsAppCallbackData,
} from "./cards";
import { WhatsAppApiError } from "./errors";
import { WhatsAppFormatConverter } from "./markdown";
import type {
  WhatsAppAdapterConfig,
  WhatsAppContact,
  WhatsAppInboundMessage,
  WhatsAppInteractiveMessage,
  WhatsAppMediaResponse,
  WhatsAppMediaUploadResponse,
  WhatsAppRawMessage,
  WhatsAppSendResponse,
  WhatsAppTemplateComponent,
  WhatsAppTemplateMessage,
  WhatsAppThreadId,
  WhatsAppTypingIndicatorResponse,
  WhatsAppWebhookPayload,
  WhatsAppWebhookValue,
} from "./types";

export { WhatsAppApiError } from "./errors";

/** Platform label for shared buffer utilities (not yet in PlatformName union). */
const WHATSAPP_BUFFER_PLATFORM = "whatsapp" as PlatformName;

/** Default Graph API version */
const DEFAULT_API_VERSION = "v25.0";

/** Maximum message length for WhatsApp Cloud API */
const WHATSAPP_MESSAGE_LIMIT = 4096;

/** Maximum caption length for WhatsApp media messages */
const WHATSAPP_CAPTION_LIMIT = 1024;

const WHATSAPP_MEDIA_HOSTS = ["fbcdn.net", "fbsbx.com"];

function isWhatsAppMediaUrl(url: string, graphApiUrl: string): boolean {
  try {
    const mediaUrl = new URL(url);
    if (mediaUrl.origin === new URL(graphApiUrl).origin) {
      return true;
    }
    return (
      mediaUrl.protocol === "https:" &&
      mediaUrl.port === "" &&
      WHATSAPP_MEDIA_HOSTS.some(
        (host) =>
          mediaUrl.hostname === host || mediaUrl.hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    return false;
  }
}

/** WhatsApp media message types supported for outbound sends */
export type WhatsAppMediaType = "image" | "document" | "video" | "audio";

/** Per-type upload size limits (bytes) from WhatsApp Cloud API */
const WHATSAPP_MEDIA_SIZE_LIMITS: Record<WhatsAppMediaType, number> = {
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

interface ResolvedWhatsAppMedia {
  captionEligible: boolean;
  filename?: string;
  mimeType: string;
  payload: { id?: string; link?: string };
  type: WhatsAppMediaType;
}

interface WhatsAppIdentity {
  bsuid?: string;
  parent?: string;
  phone?: string;
  userId: string;
}

interface WhatsAppRoute {
  bsuid?: string;
  parent?: string;
  phone?: string;
}

interface WhatsAppRecipient {
  recipient?: string;
  to?: string;
}

const BSUID_PATTERN = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Map a MIME type to a WhatsApp outbound media message type.
 */
export function getWhatsAppMediaType(mimeType: string): WhatsAppMediaType {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (normalized === "image/jpeg" || normalized === "image/png") {
    return "image";
  }

  if (normalized.startsWith("image/")) {
    return "document";
  }

  if (normalized === "video/mp4" || normalized === "video/3gpp") {
    return "video";
  }

  if (normalized.startsWith("audio/")) {
    return "audio";
  }

  return "document";
}

/**
 * Validate binary size against WhatsApp per-type limits.
 */
export function validateFileSize(type: WhatsAppMediaType, size: number): void {
  const limit = WHATSAPP_MEDIA_SIZE_LIMITS[type];

  if (size > limit) {
    throw new ValidationError(
      "whatsapp",
      `File size ${size} bytes exceeds WhatsApp ${type} limit of ${limit} bytes`
    );
  }
}

function inferMimeType(filename: string, mimeType?: string): string {
  if (mimeType) {
    return mimeType;
  }

  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";

  return EXTENSION_MIME_TYPES[extension] ?? "application/octet-stream";
}

function attachmentToWhatsAppType(attachment: Attachment): WhatsAppMediaType {
  if (attachment.mimeType) {
    return getWhatsAppMediaType(attachment.mimeType);
  }

  switch (attachment.type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      return "document";
  }
}

/**
 * Convert emoji placeholders in a template component's text parameters only.
 * Payloads, URLs, and media references stay literal so colon-delimited data
 * (e.g. a quick-reply payload) is never mistaken for an emoji shortcode.
 */
function convertTemplateComponentEmoji(
  component: WhatsAppTemplateComponent
): WhatsAppTemplateComponent {
  return component.type === "button"
    ? {
        ...component,
        parameters: component.parameters.map((parameter) =>
          parameter.type === "text"
            ? {
                ...parameter,
                text: convertEmojiPlaceholders(parameter.text, "whatsapp"),
              }
            : parameter
        ),
      }
    : {
        ...component,
        parameters: component.parameters.map((parameter) =>
          parameter.type === "text"
            ? {
                ...parameter,
                text: convertEmojiPlaceholders(parameter.text, "whatsapp"),
              }
            : parameter
        ),
      };
}

/**
 * Split text into chunks that fit within WhatsApp's message limit,
 * breaking on paragraph boundaries (\n\n) when possible, then line
 * boundaries (\n), and finally at the character limit as a last resort.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= WHATSAPP_MESSAGE_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > WHATSAPP_MESSAGE_LIMIT) {
    const slice = remaining.slice(0, WHATSAPP_MESSAGE_LIMIT);

    // Try to break at a paragraph boundary
    let breakIndex = slice.lastIndexOf("\n\n");
    if (breakIndex === -1 || breakIndex < WHATSAPP_MESSAGE_LIMIT / 2) {
      // Try a line boundary
      breakIndex = slice.lastIndexOf("\n");
    }
    if (breakIndex === -1 || breakIndex < WHATSAPP_MESSAGE_LIMIT / 2) {
      // Hard break at the limit
      breakIndex = WHATSAPP_MESSAGE_LIMIT;
    }

    chunks.push(remaining.slice(0, breakIndex).trimEnd());
    remaining = remaining.slice(breakIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// Re-export types
export type {
  WhatsAppAdapterConfig,
  WhatsAppGraphError,
  WhatsAppGraphErrorBody,
  WhatsAppMediaResponse,
  WhatsAppRawMessage,
  WhatsAppTemplateButtonParameter,
  WhatsAppTemplateComponent,
  WhatsAppTemplateMessage,
  WhatsAppTemplateParameter,
  WhatsAppThreadId,
} from "./types";

/**
 * WhatsApp adapter for chat SDK.
 *
 * Supports messaging via the WhatsApp Business Cloud API (Meta Graph API).
 * All conversations are 1:1 DMs between the business phone number and users.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     whatsapp: createWhatsAppAdapter(),
 *   },
 *   state: new MemoryState(),
 * });
 * ```
 */
export class WhatsAppAdapter
  implements Adapter<WhatsAppThreadId, WhatsAppRawMessage>
{
  readonly name = "whatsapp";
  readonly lockScope = "channel" as const;
  readonly persistThreadHistory = true;
  readonly userName: string;

  protected readonly accessToken: string;
  protected readonly appSecret: string;
  protected readonly phoneNumberId: string;
  protected readonly verifyToken: string;
  protected readonly graphApiUrl: string;
  protected chat: ChatInstance | null = null;
  protected readonly logger: Logger;
  protected _botUserId: string | null = null;
  protected readonly formatConverter = new WhatsAppFormatConverter();

  /** Bot user ID used for self-message detection */
  get botUserId(): string | undefined {
    return this._botUserId ?? undefined;
  }

  constructor(
    config: WhatsAppAdapterConfig & {
      accessToken: string;
      appSecret: string;
      logger: Logger;
      phoneNumberId: string;
      userName: string;
      verifyToken: string;
    }
  ) {
    this.accessToken = config.accessToken;
    this.appSecret = config.appSecret;
    this.phoneNumberId = config.phoneNumberId;
    this.verifyToken = config.verifyToken;
    this.logger = config.logger;
    this.userName = config.userName;
    const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    const baseUrl = config.apiUrl ?? "https://graph.facebook.com";
    this.graphApiUrl = `${baseUrl}/${apiVersion}`;
  }

  /**
   * Initialize the adapter and fetch business profile info.
   */
  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // The bot's "user ID" is the phone number ID
    this._botUserId = this.phoneNumberId;
    this.logger.info("WhatsApp adapter initialized", {
      phoneNumberId: this.phoneNumberId,
    });
  }

  /**
   * Handle incoming webhook from WhatsApp.
   *
   * Handles both the GET verification challenge and POST event notifications.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Handle webhook verification challenge (GET request)
    if (request.method === "GET") {
      return this.handleVerificationChallenge(request);
    }

    const body = await request.text();
    this.logger.debug("WhatsApp webhook raw body", {
      body: body.substring(0, 500),
    });

    // Verify request signature (X-Hub-Signature-256 header)
    const signature = request.headers.get("x-hub-signature-256");
    if (!this.verifySignature(body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the JSON payload
    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("WhatsApp webhook invalid JSON", {
        contentType: request.headers.get("content-type"),
        bodyPreview: body.substring(0, 200),
      });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Process entries
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field === "user_id_update") {
          await this.handleUserIdUpdate(change.value);
          continue;
        }

        if (change.field !== "messages") {
          continue;
        }

        const { value } = change;

        // Process incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            try {
              const contact =
                value.contacts?.find(
                  (item) =>
                    (message.from_user_id &&
                      item.user_id === message.from_user_id) ||
                    (message.from && item.wa_id === message.from)
                ) ?? value.contacts?.[0];
              const identity = await this.resolve(
                message,
                contact,
                value.metadata.phone_number_id
              );
              if (!identity) {
                this.logger.warn("WhatsApp message has no user identifier", {
                  messageId: message.id,
                });
                continue;
              }
              if (message.type === "system") {
                continue;
              }
              this.handleInboundMessage(
                message,
                contact,
                value.metadata.phone_number_id,
                options,
                identity
              );
            } catch (error) {
              this.logger.error("Failed to handle inbound message", {
                messageId: message.id,
                error,
              });
            }
          }
        }
      }
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Handle the webhook verification challenge from Meta.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
   */
  protected handleVerificationChallenge(request: Request): Response {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.verifyToken) {
      this.logger.info("WhatsApp webhook verification succeeded");
      return new Response(challenge ?? "", { status: 200 });
    }

    this.logger.warn("WhatsApp webhook verification failed", {
      mode,
      tokenMatch: token === this.verifyToken,
    });
    return new Response("Forbidden", { status: 403 });
  }

  /**
   * Verify webhook signature using HMAC-SHA256 with the App Secret.
   *
   * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
   */
  protected verifySignature(body: string, signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    const expectedSignature = `sha256=${createHmac("sha256", this.appSecret).update(body).digest("hex")}`;

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle an inbound message from a user.
   */
  protected handleInboundMessage(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions,
    identity?: WhatsAppIdentity
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring message");
      return;
    }

    const user = identity ?? this.fields(inbound, contact);
    if (!user) {
      this.logger.warn("WhatsApp message has no user identifier", {
        messageId: inbound.id,
      });
      return;
    }

    // Handle reactions separately
    if (inbound.type === "reaction" && inbound.reaction) {
      this.handleReaction(inbound, contact, phoneNumberId, options, user);
      return;
    }

    // Handle interactive message replies (button clicks)
    if (inbound.type === "interactive" && inbound.interactive) {
      this.handleInteractiveReply(
        inbound,
        contact,
        phoneNumberId,
        options,
        user
      );
      return;
    }

    // Handle legacy button responses (from template quick replies)
    if (inbound.type === "button" && inbound.button) {
      this.handleButtonResponse(inbound, contact, phoneNumberId, options, user);
      return;
    }

    // Extract text content based on message type
    const text = this.extractTextContent(inbound);
    if (text === null) {
      this.logger.debug("Unsupported message type, ignoring", {
        type: inbound.type,
        messageId: inbound.id,
      });
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: user.userId,
    });

    const message = this.buildMessage(
      inbound,
      contact,
      threadId,
      text,
      phoneNumberId,
      user
    );
    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Handle reaction events.
   */
  protected handleReaction(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions,
    identity?: WhatsAppIdentity
  ): void {
    if (!(this.chat && inbound.reaction)) {
      return;
    }

    const user = identity ?? this.fields(inbound, contact);
    if (!user) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: user.userId,
    });

    const rawEmoji = inbound.reaction.emoji;
    // Empty emoji means reaction was removed
    const added = rawEmoji !== "";
    const emojiValue = added ? getEmoji(rawEmoji) : getEmoji("");

    const author = this.author(user, contact);

    const event: Omit<ReactionEvent, "adapter" | "thread"> = {
      emoji: emojiValue,
      rawEmoji,
      added,
      user: author,
      messageId: inbound.reaction.message_id,
      threadId,
      raw: inbound,
    };

    this.chat.processReaction({ ...event, adapter: this }, options);
  }

  /**
   * Handle interactive message replies (button/list selection).
   */
  protected handleInteractiveReply(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions,
    identity?: WhatsAppIdentity
  ): void {
    if (!(this.chat && inbound.interactive)) {
      return;
    }

    const user = identity ?? this.fields(inbound, contact);
    if (!user) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: user.userId,
    });

    const { interactive } = inbound;
    let rawId: string;
    let fallbackValue: string;

    if (interactive.type === "button_reply" && interactive.button_reply) {
      rawId = interactive.button_reply.id;
      fallbackValue = interactive.button_reply.title;
    } else if (interactive.type === "list_reply" && interactive.list_reply) {
      rawId = interactive.list_reply.id;
      fallbackValue = interactive.list_reply.title;
    } else {
      return;
    }

    const { actionId, value } = decodeWhatsAppCallbackData(rawId);

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value: value ?? fallbackValue,
        user: this.author(user, contact),
        messageId: inbound.id,
        threadId,
        raw: inbound,
      },
      options
    );
  }

  /**
   * Handle legacy button responses (from template quick replies).
   */
  protected handleButtonResponse(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions,
    identity?: WhatsAppIdentity
  ): void {
    if (!(this.chat && inbound.button)) {
      return;
    }

    const user = identity ?? this.fields(inbound, contact);
    if (!user) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: user.userId,
    });

    this.chat.processAction(
      {
        adapter: this,
        actionId: inbound.button.payload,
        value: inbound.button.text,
        user: this.author(user, contact),
        messageId: inbound.id,
        threadId,
        raw: inbound,
      },
      options
    );
  }

  protected author(
    identity: WhatsAppIdentity,
    contact?: WhatsAppContact
  ): Author {
    // `||` rather than `??`: an empty-string profile name must still fall
    // back to the user ID.
    return {
      userId: identity.userId,
      userName:
        contact?.profile.username || contact?.profile.name || identity.userId,
      fullName:
        contact?.profile.name || contact?.profile.username || identity.userId,
      isBot: false,
      isMe: identity.userId === this._botUserId,
    };
  }

  private fields(
    inbound: WhatsAppInboundMessage,
    contact?: WhatsAppContact
  ): WhatsAppIdentity | null {
    const phone = inbound.system?.wa_id ?? inbound.from ?? contact?.wa_id;
    const bsuid =
      inbound.system?.user_id ?? inbound.from_user_id ?? contact?.user_id;
    const parent =
      inbound.system?.parent_user_id ??
      inbound.from_parent_user_id ??
      contact?.parent_user_id;
    const userId = phone ?? bsuid ?? parent;

    return userId ? { bsuid, parent, phone, userId } : null;
  }

  protected async resolve(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string
  ): Promise<WhatsAppIdentity | null> {
    const identity = this.fields(inbound, contact);
    if (!identity) {
      return null;
    }

    const { bsuid, parent, phone } = identity;
    const changed = inbound.type === "system";
    // A system message's `from` carries the pre-change identifier, so
    // prefer it as the canonical fallback — a thread that predates any
    // alias state keeps its original key that way.
    const source = changed ? inbound.from : undefined;
    const fallback = source ?? identity.userId;

    if (!this.chat) {
      return { bsuid, parent, phone, userId: fallback };
    }

    const identifiers = [source, bsuid, parent, phone].filter(
      (value): value is string => Boolean(value)
    );

    try {
      return await this.link(
        this.chat.getState(),
        phoneNumberId,
        identifiers,
        fallback,
        (route) => ({
          bsuid: bsuid ?? route.bsuid,
          parent: parent ?? route.parent,
          // A system message re-keys the phone: absent means the user no
          // longer exposes one, so any stored number is stale.
          phone: changed ? phone : (phone ?? route.phone),
        })
      );
    } catch (error) {
      this.logger.warn("Failed to persist WhatsApp user identity", {
        error,
        messageId: inbound.id,
      });
      return { bsuid, parent, phone, userId: fallback };
    }
  }

  /**
   * Handle a `user_id_update` change, which Meta sends when a phone
   * number change rotates a user's business-scoped user ID. The payload
   * carries the previous and current values, so both get aliased to the
   * same canonical user and the route picks up the new identifiers.
   *
   * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
   */
  protected async handleUserIdUpdate(
    value: WhatsAppWebhookValue
  ): Promise<void> {
    if (!this.chat) {
      return;
    }

    const phoneNumberId = value.metadata.phone_number_id;
    for (const update of value.user_id_update ?? []) {
      const identifiers = [
        update.user_id?.previous,
        update.parent_user_id?.previous,
        update.user_id?.current,
        update.parent_user_id?.current,
        update.wa_id,
      ].filter((identifier): identifier is string => Boolean(identifier));
      // Prefer the previous BSUID as the canonical fallback so a thread
      // keyed by it survives the rotation even without alias state.
      const fallback = identifiers[0];
      if (!fallback) {
        continue;
      }

      try {
        await this.link(
          this.chat.getState(),
          phoneNumberId,
          identifiers,
          fallback,
          (route) => ({
            bsuid: update.user_id?.current ?? route.bsuid,
            parent: update.parent_user_id?.current ?? route.parent,
            // The rotation implies a phone number change, so any stored
            // phone is stale; keep only the update's wa_id, when present.
            phone: update.wa_id,
          })
        );
      } catch (error) {
        this.logger.warn("Failed to apply WhatsApp user ID update", { error });
      }
    }
  }

  /**
   * Resolve the canonical user ID for a set of equivalent identifiers
   * and persist the alias and route entries that changed. Aliases are
   * looked up in parallel but honored in order, so callers should list
   * the identifiers most likely to match an existing thread first.
   */
  private async link(
    state: StateAdapter,
    phoneNumberId: string,
    identifiers: string[],
    fallback: string,
    merge: (route: WhatsAppRoute) => WhatsAppRoute
  ): Promise<WhatsAppIdentity> {
    const aliases = await Promise.all(
      identifiers.map((identifier) =>
        state.get<string>(this.key("alias", phoneNumberId, identifier))
      )
    );
    const userId =
      aliases.find((value): value is string => Boolean(value)) ?? fallback;

    const path = this.key("route", phoneNumberId, userId);
    const route = (await state.get<WhatsAppRoute>(path)) ?? {};
    const updated = merge(route);

    const writes = identifiers
      .filter((_, index) => aliases[index] !== userId)
      .map((identifier) =>
        state.set(this.key("alias", phoneNumberId, identifier), userId)
      );
    if (
      route.bsuid !== updated.bsuid ||
      route.parent !== updated.parent ||
      route.phone !== updated.phone
    ) {
      writes.push(state.set(path, updated));
    }
    await Promise.all(writes);

    return { ...updated, userId };
  }

  protected async recipient(
    threadId: string,
    userId: string
  ): Promise<WhatsAppRecipient> {
    if (this.chat) {
      try {
        const { phoneNumberId } = this.decodeThreadId(threadId);
        const route = await this.chat
          .getState()
          .get<WhatsAppRoute>(this.key("route", phoneNumberId, userId));
        const recipient = route?.bsuid ?? route?.parent;
        // Only honor a stored route that can actually address someone;
        // an empty route falls through to the userId below.
        if (route?.phone || recipient) {
          return {
            ...(route?.phone ? { to: route.phone } : {}),
            ...(recipient ? { recipient } : {}),
          };
        }
      } catch (error) {
        this.logger.warn("Failed to resolve WhatsApp recipient", {
          error,
          threadId,
        });
      }
    }

    return BSUID_PATTERN.test(userId) ? { recipient: userId } : { to: userId };
  }

  private key(kind: "alias" | "route", phone: string, value: string): string {
    return `whatsapp:identity:${kind}:${phone}:${value}`;
  }

  /**
   * Extract text content from an inbound message.
   * Returns null for unsupported message types.
   */
  protected extractTextContent(message: WhatsAppInboundMessage): string | null {
    switch (message.type) {
      case "text":
        return message.text?.body ?? null;
      case "image":
        return message.image?.caption ?? "[Image]";
      case "document":
        return (
          message.document?.caption ??
          `[Document: ${message.document?.filename ?? "file"}]`
        );
      case "audio":
        return "[Audio message]";
      case "voice":
        return "[Voice message]";
      case "video":
        return "[Video]";
      case "sticker":
        return "[Sticker]";
      case "location": {
        const loc = message.location;
        if (loc) {
          const parts = [`[Location: ${loc.latitude}, ${loc.longitude}`];
          if (loc.name) {
            parts[0] = `[Location: ${loc.name}`;
          }
          if (loc.address) {
            parts.push(loc.address);
          }
          return `${parts.join(" - ")}]`;
        }
        return "[Location]";
      }
      default:
        return null;
    }
  }

  /**
   * Build a Message from a WhatsApp inbound message.
   */
  protected buildMessage(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    threadId: string,
    text: string,
    phoneNumberId: string | undefined,
    identity?: WhatsAppIdentity
  ): Message<WhatsAppRawMessage> {
    const user = identity ?? this.fields(inbound, contact);
    if (!user) {
      throw new ValidationError("whatsapp", "Message has no user identifier");
    }

    const author = this.author(user, contact);

    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const raw: WhatsAppRawMessage = {
      message: inbound,
      contact,
      phoneNumberId: phoneNumberId || this.phoneNumberId,
      userId: user.userId,
    };

    const attachments = this.buildAttachments(inbound);

    return new Message<WhatsAppRawMessage>({
      id: inbound.id,
      threadId,
      text,
      formatted,
      raw,
      author,
      metadata: {
        dateSent: new Date(Number.parseInt(inbound.timestamp, 10) * 1000),
        edited: false,
      },
      attachments,
    });
  }

  /**
   * Build attachments from an inbound message.
   */
  protected buildAttachments(inbound: WhatsAppInboundMessage): Attachment[] {
    const attachments: Attachment[] = [];

    if (inbound.image) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.image.id,
          "image",
          inbound.image.mime_type
        )
      );
    }

    if (inbound.document) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.document.id,
          "file",
          inbound.document.mime_type,
          inbound.document.filename
        )
      );
    }

    if (inbound.audio) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.audio.id,
          "audio",
          inbound.audio.mime_type
        )
      );
    }

    if (inbound.video) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.video.id,
          "video",
          inbound.video.mime_type
        )
      );
    }

    if (inbound.voice) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.voice.id,
          "audio",
          inbound.voice.mime_type,
          "voice"
        )
      );
    }

    if (inbound.sticker) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.sticker.id,
          "image",
          inbound.sticker.mime_type,
          "sticker"
        )
      );
    }

    if (inbound.location) {
      const loc = inbound.location;
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        attachments.push({
          type: "file",
          name: loc.name || "Location",
          url: mapUrl,
          mimeType: "application/geo+json",
        });
      }
    }

    return attachments;
  }

  /**
   * Build a single media attachment with a lazy fetchData function.
   */
  protected buildMediaAttachment(
    mediaId: string,
    type: Attachment["type"],
    mimeType: string,
    name?: string
  ): Attachment {
    return {
      type,
      mimeType,
      name,
      fetchMetadata: { mediaId },
      fetchData: () => this.downloadMedia(mediaId),
    };
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    const mediaId = attachment.fetchMetadata?.mediaId;
    if (!mediaId) {
      return attachment;
    }
    return {
      ...attachment,
      fetchData: () => this.downloadMedia(mediaId),
    };
  }

  /**
   * Download media from WhatsApp.
   *
   * WhatsApp media is fetched in two steps:
   * 1. GET the media metadata to obtain the download URL
   * 2. GET the actual binary data from the download URL
   *
   * @param mediaId - The media ID from the inbound message
   * @returns The media data as a Buffer
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#download-media
   */
  async downloadMedia(
    mediaId: string,
    transport?: AttachmentTransport
  ): Promise<Buffer> {
    // Step 1: Get the media URL
    const mediaInfo = await this.graphFetchJson<WhatsAppMediaResponse>(
      `${this.graphApiUrl}/${mediaId}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
      "Failed to get media URL",
      { mediaId }
    );

    if (!isWhatsAppMediaUrl(mediaInfo.url, this.graphApiUrl)) {
      throw new NetworkError(
        "whatsapp",
        "Refusing to send the access token to an untrusted media URL"
      );
    }

    // Step 2: Download the actual file. Every hop is checked against the
    // exact-origin and Meta media host policy before the access token is
    // attached, so a redirect cannot carry it to an off-policy host.
    try {
      return await downloadAttachment(mediaInfo.url, {
        adapter: "whatsapp",
        headers: (target) => {
          if (!isWhatsAppMediaUrl(target.href, this.graphApiUrl)) {
            throw new NetworkError(
              "whatsapp",
              "Refusing to send the access token to an untrusted media URL"
            );
          }
          return { authorization: `Bearer ${this.accessToken}` };
        },
        hosts: [...WHATSAPP_MEDIA_HOSTS, new URL(this.graphApiUrl).hostname],
        transport,
      });
    } catch (error) {
      this.logger.error("Failed to download media", { mediaId });
      if (error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(
        "whatsapp",
        `Failed to download media ${mediaId}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Send a message to a WhatsApp user.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    return this.send(threadId, message);
  }

  protected async send(
    threadId: string,
    message: AdapterPostableMessage,
    replyId?: string
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const { userWaId } = this.decodeThreadId(threadId);
    // Resolve the route once per logical post; the send helpers reuse it
    // across chunked and multi-part sends.
    const recipient = await this.recipient(threadId, userWaId);
    const files = extractFiles(message);
    const attachments = extractPostableAttachments(message);
    const mediaItems: Array<FileUpload | Attachment> = [
      ...files,
      ...attachments,
    ];

    if (mediaItems.length > 0) {
      return this.postMessageWithMedia(
        threadId,
        userWaId,
        message,
        mediaItems,
        replyId,
        recipient
      );
    }

    // Check if this is a card with interactive buttons
    const card = extractCard(message);
    if (card) {
      const result = cardToWhatsApp(card);
      if (result.type === "interactive") {
        // Convert emoji placeholders in interactive message fields
        const interactive = JSON.parse(
          convertEmojiPlaceholders(
            JSON.stringify(result.interactive),
            "whatsapp"
          )
        ) as WhatsAppInteractiveMessage;

        return this.sendInteractiveMessage(
          threadId,
          userWaId,
          interactive,
          replyId,
          recipient
        );
      }

      return this.sendTextMessage(
        threadId,
        userWaId,
        convertEmojiPlaceholders(result.text, "whatsapp"),
        replyId,
        recipient
      );
    }

    // Regular text message
    const body = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "whatsapp"
    );

    return this.sendTextMessage(threadId, userWaId, body, replyId, recipient);
  }

  async reply(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    return this.send(threadId, message, messageId);
  }

  /**
   * Send one or more media messages, optionally followed by a card.
   */
  protected async postMessageWithMedia(
    threadId: string,
    userWaId: string,
    message: AdapterPostableMessage,
    mediaItems: Array<FileUpload | Attachment>,
    replyId?: string,
    recipient?: WhatsAppRecipient
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    let remainingId = replyId;
    const card = extractCard(message);
    // cta_url promotion is disabled alongside media: the text fallback
    // captions the media in a single send, whereas an interactive
    // message would strip the caption and cost a second API send.
    const cardResult = card
      ? cardToWhatsApp(card, { allowCtaUrl: false })
      : null;

    let text = "";

    if (card) {
      if (cardResult && cardResult.type !== "interactive") {
        // The shared fallback excludes action elements, so append link
        // button URLs to keep them reachable from the caption.
        const fallback = [
          cardToFallbackText(card),
          ...cardLinkButtonLines(card),
        ]
          .filter(Boolean)
          .join("\n");
        text = convertEmojiPlaceholders(fallback, "whatsapp");
      }
    } else {
      text = convertEmojiPlaceholders(
        this.renderPostableText(message),
        "whatsapp"
      );
    }

    const resolved = await Promise.all(
      mediaItems.map((item) => this.resolveMedia(item))
    );

    const firstMedia = resolved[0];
    const useSeparateText =
      text.length > 0 &&
      (text.length > WHATSAPP_CAPTION_LIMIT ||
        firstMedia?.type === "audio" ||
        !firstMedia?.captionEligible);

    if (useSeparateText) {
      await this.sendTextMessage(
        threadId,
        userWaId,
        text,
        remainingId,
        recipient
      );
      remainingId = undefined;
    }

    let result: RawMessage<WhatsAppRawMessage> | undefined;

    for (const [index, media] of resolved.entries()) {
      const caption =
        index === 0 &&
        !useSeparateText &&
        text.length > 0 &&
        media.captionEligible
          ? text
          : undefined;

      result = await this.sendMediaMessage(
        threadId,
        userWaId,
        media.type,
        media.payload,
        caption,
        media.filename,
        remainingId,
        recipient
      );
      remainingId = undefined;
    }

    if (cardResult) {
      if (cardResult.type === "interactive") {
        const interactive = JSON.parse(
          convertEmojiPlaceholders(
            JSON.stringify(cardResult.interactive),
            "whatsapp"
          )
        ) as WhatsAppInteractiveMessage;

        result = await this.sendInteractiveMessage(
          threadId,
          userWaId,
          interactive,
          remainingId,
          recipient
        );
        remainingId = undefined;
      } else if (text.length === 0) {
        result = await this.sendTextMessage(
          threadId,
          userWaId,
          convertEmojiPlaceholders(cardResult.text, "whatsapp"),
          remainingId,
          recipient
        );
        remainingId = undefined;
      }
    }

    if (!result) {
      throw new Error("WhatsApp media message did not return a result");
    }

    return result;
  }

  /**
   * Split text into chunks that fit within WhatsApp's message limit,
   * breaking on paragraph boundaries (\n\n) when possible, then line
   * boundaries (\n), and finally at the character limit as a last resort.
   */
  splitMessage(text: string): string[] {
    return splitMessage(text);
  }

  /**
   * Send a single text message via the Cloud API (must be within the
   * 4096-character limit).
   */
  protected async sendSingleTextMessage(
    threadId: string,
    to: string,
    text: string,
    replyId?: string,
    recipient?: WhatsAppRecipient
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const response = await this.graphApiRequest<WhatsAppSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...(recipient ?? (await this.recipient(threadId, to))),
        ...(replyId ? { context: { message_id: replyId } } : {}),
        type: "text",
        text: { preview_url: false, body: text },
      }
    );

    if (!(response.messages?.length && response.messages[0]?.id)) {
      throw new Error(
        "WhatsApp API did not return a message ID for text message"
      );
    }
    const messageId = response.messages[0].id;

    return {
      id: messageId,
      threadId,
      raw: {
        message: {
          id: messageId,
          from: this.phoneNumberId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: text },
        },
        phoneNumberId: this.phoneNumberId,
      },
    };
  }

  /**
   * Send a text message, splitting into multiple messages if it exceeds
   * WhatsApp's 4096-character limit. Returns the last message sent.
   */
  protected async sendTextMessage(
    threadId: string,
    to: string,
    text: string,
    replyId?: string,
    recipient?: WhatsAppRecipient
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const chunks = this.splitMessage(text);
    // Resolve the route once so chunked sends share a single lookup.
    const resolved = recipient ?? (await this.recipient(threadId, to));
    let result: RawMessage<WhatsAppRawMessage> | undefined;

    for (const [index, chunk] of chunks.entries()) {
      result = await this.sendSingleTextMessage(
        threadId,
        to,
        chunk,
        index === 0 ? replyId : undefined,
        resolved
      );
    }

    return result as RawMessage<WhatsAppRawMessage>;
  }

  /**
   * Send an interactive message (buttons or list) via the Cloud API.
   */
  protected async sendInteractiveMessage(
    threadId: string,
    to: string,
    interactive: WhatsAppInteractiveMessage,
    replyId?: string,
    recipient?: WhatsAppRecipient
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const response = await this.graphApiRequest<WhatsAppSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...(recipient ?? (await this.recipient(threadId, to))),
        ...(replyId ? { context: { message_id: replyId } } : {}),
        type: "interactive",
        interactive,
      }
    );

    if (!(response.messages?.length && response.messages[0]?.id)) {
      throw new Error(
        "WhatsApp API did not return a message ID for interactive message"
      );
    }
    const messageId = response.messages[0].id;

    return {
      id: messageId,
      threadId,
      raw: {
        message: {
          id: messageId,
          from: this.phoneNumberId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "interactive",
        },
        phoneNumberId: this.phoneNumberId,
      },
    };
  }

  /**
   * Send a pre-approved template message via the Cloud API.
   *
   * Templates are the only message type WhatsApp accepts outside the
   * 24-hour customer service window, making them the way to start
   * business-initiated conversations. The adapter does not auto-substitute
   * templates for outbound text posts — callers must opt in explicitly
   * when they detect the window is closed.
   *
   * @example
   * ```typescript
   * await adapter.sendTemplate(threadId, {
   *   name: "appointment_reminder",
   *   language: "en",
   *   components: [
   *     {
   *       type: "body",
   *       parameters: [{ type: "text", text: "Tomorrow at 2pm" }],
   *     },
   *   ],
   * });
   * ```
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
   */
  async sendTemplate(
    threadId: string,
    template: WhatsAppTemplateMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const { userWaId } = this.decodeThreadId(threadId);

    // Convert emoji placeholders in text parameters only; payloads, URLs, and
    // media references must stay literal (see convertTemplateComponentEmoji).
    const components = template.components?.length
      ? template.components.map(convertTemplateComponentEmoji)
      : undefined;

    const response = await this.graphApiRequest<WhatsAppSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...(await this.recipient(threadId, userWaId)),
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          ...(components ? { components } : {}),
        },
      }
    );

    if (!(response.messages?.length && response.messages[0]?.id)) {
      throw new Error(
        "WhatsApp API did not return a message ID for template message"
      );
    }
    const messageId = response.messages[0].id;

    return {
      id: messageId,
      threadId,
      raw: {
        message: {
          id: messageId,
          from: this.phoneNumberId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "template",
        },
        phoneNumberId: this.phoneNumberId,
      },
    };
  }

  /**
   * Edit a message. Not supported by WhatsApp Cloud API — throws an error.
   *
   * Callers should use postMessage directly if they want to send a follow-up.
   */
  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    throw new Error(
      "WhatsApp does not support editing messages. Use postMessage to send a new message instead."
    );
  }

  /**
   * Stream a message by buffering all chunks and sending as a single message.
   * WhatsApp doesn't support message editing, so we can't do incremental updates.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    let accumulated = "";
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        accumulated += chunk;
      } else if (chunk.type === "markdown_text") {
        accumulated += chunk.text;
      }
    }
    return this.postMessage(threadId, { markdown: accumulated });
  }

  /**
   * Delete a message. Not supported by WhatsApp Cloud API — throws an error.
   */
  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new Error("WhatsApp does not support deleting messages.");
  }

  /**
   * Add a reaction to a message.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/reaction-messages
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);
    const emojiStr = this.resolveEmoji(emoji);

    await this.graphApiRequest(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...(await this.recipient(threadId, userWaId)),
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: emojiStr,
      },
    });
  }

  /**
   * Remove a reaction from a message.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/reaction-messages
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);

    // WhatsApp removes reactions by sending an empty emoji
    await this.graphApiRequest(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...(await this.recipient(threadId, userWaId)),
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: "",
      },
    });
  }

  /**
   * Start typing indicator.
   *
   * WhatsApp typing indicators require the most recent inbound message ID.
   * They also implicitly mark the referenced message as read.
   *
   * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators
   */
  async startTyping(threadId: string, status?: string): Promise<void> {
    const messageId = await this.resolveTypingTargetMessageId(threadId);
    this.logger.debug("WhatsApp typing indicator requested", {
      messageId,
      threadId,
    });

    if (!messageId) {
      this.logger.warn(
        "WhatsApp typing indicator skipped - no inbound message context",
        { threadId }
      );
      return;
    }

    if (status) {
      this.logger.warn("WhatsApp typing indicator ignores custom status text", {
        status,
        threadId,
        messageId,
      });
    }

    const response =
      await this.graphApiRequest<WhatsAppTypingIndicatorResponse>(
        `/${this.phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: {
            type: "text",
          },
        }
      );

    if (!response.success) {
      this.logger.error(
        "WhatsApp typing indicator failed: API returned success=false",
        {
          messageId,
          threadId,
        }
      );
      throw new AdapterError("WhatsApp typing indicator failed", "whatsapp");
    }
  }

  /**
   * Fetch messages. Not supported by WhatsApp Cloud API.
   *
   * WhatsApp does not provide an API to retrieve message history.
   */
  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<WhatsAppRawMessage>> {
    this.logger.debug(
      "fetchMessages not supported on WhatsApp - message history is not available via Cloud API"
    );
    return { messages: [] };
  }

  /**
   * Fetch thread info.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { phoneNumberId, userWaId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: `whatsapp:${phoneNumberId}`,
      channelName: `WhatsApp: ${userWaId}`,
      isDM: true,
      metadata: { phoneNumberId, userWaId },
    };
  }

  /**
   * Encode a WhatsApp thread ID.
   *
   * Format: whatsapp:{phoneNumberId}:{userWaId}
   */
  encodeThreadId(platformData: WhatsAppThreadId): string {
    return `whatsapp:${platformData.phoneNumberId}:${platformData.userWaId}`;
  }

  /**
   * Decode a WhatsApp thread ID.
   *
   * Format: whatsapp:{phoneNumberId}:{userWaId}
   */
  decodeThreadId(threadId: string): WhatsAppThreadId {
    if (!threadId.startsWith("whatsapp:")) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID: ${threadId}`
      );
    }

    const withoutPrefix = threadId.slice(9);
    if (!withoutPrefix) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID format: ${threadId}`
      );
    }

    const parts = withoutPrefix.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID format: ${threadId}`
      );
    }

    return {
      phoneNumberId: parts[0],
      userWaId: parts[1],
    };
  }

  /**
   * Derive channel ID from a WhatsApp thread ID.
   * On WhatsApp every conversation is a 1:1 DM, so channel === thread.
   */
  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  /**
   * All WhatsApp conversations are DMs.
   */
  isDM(_threadId: string): boolean {
    return true;
  }

  /**
   * Open a DM with a user. Returns the thread ID for the conversation.
   *
   * For WhatsApp, this simply constructs the thread ID since all
   * conversations are inherently DMs. Note: you can only message users
   * who have messaged you first (within the 24-hour window) or
   * via approved template messages (see {@link sendTemplate}).
   */
  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userWaId: userId,
    });
  }

  /**
   * Parse platform message format to normalized format.
   */
  parseMessage(raw: WhatsAppRawMessage): Message<WhatsAppRawMessage> {
    const text = this.extractTextContent(raw.message) || "";
    const formatted: FormattedContent = this.formatConverter.toAst(text);
    const attachments = this.buildAttachments(raw.message);
    // A stored canonical userId wins; otherwise derive the identity with
    // the same precedence the webhook path uses.
    const identity = this.fields(raw.message, raw.contact);
    const userId = raw.userId ?? identity?.userId;
    if (!userId) {
      throw new ValidationError(
        "whatsapp",
        "WhatsApp message has no user identifier"
      );
    }
    const threadId = this.encodeThreadId({
      phoneNumberId: raw.phoneNumberId,
      userWaId: userId,
    });

    return new Message<WhatsAppRawMessage>({
      id: raw.message.id,
      threadId,
      text,
      formatted,
      author: this.author({ ...identity, userId }, raw.contact),
      metadata: {
        dateSent: new Date(Number.parseInt(raw.message.timestamp, 10) * 1000),
        edited: false,
      },
      attachments,
      raw,
    });
  }

  /**
   * Render formatted content to WhatsApp markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Mark an inbound message as read.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/mark-messages-as-read
   */
  async markAsRead(
    threadIdOrMessageId: string,
    messageId?: string,
    _message?: Message<WhatsAppRawMessage>
  ): Promise<void> {
    const response =
      await this.graphApiRequest<WhatsAppTypingIndicatorResponse>(
        `/${this.phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId ?? threadIdOrMessageId,
        }
      );

    if (!response.success) {
      throw new AdapterError("WhatsApp mark as read failed", "whatsapp");
    }
  }

  // =============================================================================
  // Private helpers
  // =============================================================================

  /**
   * Render optional text from a postable message (empty for files-only payloads).
   */
  protected renderPostableText(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }

    if (typeof message !== "object" || message === null) {
      return "";
    }

    if ("markdown" in message || "raw" in message || "ast" in message) {
      return this.formatConverter.renderPostable(message);
    }

    return "";
  }

  /**
   * Upload binary media to the Cloud API and return a media ID.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#upload-media
   */
  protected async uploadMedia(file: {
    data: Buffer;
    filename: string;
    mimeType: string;
  }): Promise<string> {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append(
      "file",
      new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
      file.filename
    );

    const response = await this.graphApiUpload<WhatsAppMediaUploadResponse>(
      `/${this.phoneNumberId}/media`,
      formData
    );

    if (!response.id) {
      throw new Error("WhatsApp API did not return a media ID for upload");
    }

    return response.id;
  }

  /**
   * Send a media message (image, document, video, or audio).
   */
  protected async sendMediaMessage(
    threadId: string,
    to: string,
    type: WhatsAppMediaType,
    payload: { id?: string; link?: string },
    caption?: string,
    filename?: string,
    replyId?: string,
    recipient?: WhatsAppRecipient
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const mediaObject: Record<string, string> = {};

    if (payload.id) {
      mediaObject.id = payload.id;
    }

    if (payload.link) {
      mediaObject.link = payload.link;
    }

    if (caption && type !== "audio") {
      mediaObject.caption = caption;
    }

    if (filename && type === "document") {
      mediaObject.filename = filename;
    }

    const response = await this.graphApiRequest<WhatsAppSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...(recipient ?? (await this.recipient(threadId, to))),
        ...(replyId ? { context: { message_id: replyId } } : {}),
        type,
        [type]: mediaObject,
      }
    );

    if (!(response.messages?.length && response.messages[0]?.id)) {
      throw new Error(
        `WhatsApp API did not return a message ID for ${type} message`
      );
    }

    const messageId = response.messages[0].id;

    return {
      id: messageId,
      threadId,
      raw: {
        message: {
          id: messageId,
          from: this.phoneNumberId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type,
        },
        phoneNumberId: this.phoneNumberId,
      },
    };
  }

  /**
   * Normalize a FileUpload or Attachment into a WhatsApp media payload.
   */
  protected async resolveMedia(
    item: FileUpload | Attachment
  ): Promise<ResolvedWhatsAppMedia> {
    if ("filename" in item) {
      const mimeType = inferMimeType(item.filename, item.mimeType);
      const type = getWhatsAppMediaType(mimeType);
      const buffer = await toBuffer(item.data, {
        platform: WHATSAPP_BUFFER_PLATFORM,
      });

      if (!buffer) {
        throw new ValidationError("whatsapp", "File upload data is empty");
      }

      validateFileSize(type, buffer.length);

      const mediaId = await this.uploadMedia({
        data: buffer,
        filename: item.filename,
        mimeType,
      });

      return {
        captionEligible: type !== "audio",
        filename: item.filename,
        mimeType,
        payload: { id: mediaId },
        type,
      };
    }

    const type = attachmentToWhatsAppType(item);
    const filename = item.name ?? "attachment";
    const mimeType = inferMimeType(filename, item.mimeType);

    const data =
      item.data ?? (item.fetchData ? await item.fetchData() : undefined);

    if (data) {
      const buffer = await toBuffer(data, {
        platform: WHATSAPP_BUFFER_PLATFORM,
      });

      if (!buffer) {
        throw new ValidationError("whatsapp", "Attachment data is empty");
      }

      validateFileSize(type, buffer.length);

      const mediaId = await this.uploadMedia({
        data: buffer,
        filename,
        mimeType,
      });

      return {
        captionEligible: type !== "audio",
        filename,
        mimeType,
        payload: { id: mediaId },
        type,
      };
    }

    if (!item.url) {
      throw new ValidationError(
        "whatsapp",
        "Attachment requires data, fetchData, or a public HTTPS url"
      );
    }

    if (!item.url.startsWith("https://")) {
      throw new ValidationError(
        "whatsapp",
        "Attachment URL must use HTTPS for WhatsApp link passthrough"
      );
    }

    if (typeof item.size === "number") {
      validateFileSize(type, item.size);
    }

    return {
      captionEligible: type !== "audio",
      filename,
      mimeType,
      payload: { link: item.url },
      type,
    };
  }

  /**
   * Make a multipart upload request to the Meta Graph API.
   */
  protected async graphApiUpload<T = unknown>(
    path: string,
    formData: FormData
  ): Promise<T> {
    return this.graphFetchJson<T>(
      `${this.graphApiUrl}${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: formData,
      },
      "WhatsApp API upload error",
      { path }
    );
  }

  /**
   * Resolve the latest inbound message ID for a thread.
   */
  private async resolveTypingTargetMessageId(
    threadId: string
  ): Promise<string | null> {
    if (!this.chat) {
      return null;
    }

    const state = this.chat.getState();
    const history = await new MessageHistoryCache(state).getMessages(threadId);

    for (let index = history.length - 1; index >= 0; index--) {
      const message = history[index];
      if (message && !message.author.isMe) {
        return message.id;
      }
    }

    return null;
  }

  /**
   * Make a request to the Meta Graph API.
   */
  protected async graphApiRequest<T = unknown>(
    path: string,
    body: unknown
  ): Promise<T> {
    return this.graphFetchJson<T>(
      `${this.graphApiUrl}${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      "WhatsApp API error",
      { path }
    );
  }

  /**
   * Fetch a Graph API endpoint and parse its JSON body.
   *
   * Transport failures and unparseable bodies become `NetworkError`s; a
   * non-2xx response becomes a `WhatsAppApiError` carrying Meta's error
   * envelope. `label` prefixes the error message and log line, and
   * `context` is attached to the log line.
   */
  private async graphFetchJson<T>(
    url: string,
    init: RequestInit,
    label: string,
    context: Record<string, unknown>
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      this.logger.error(label, { ...context, error });
      throw new NetworkError(
        "whatsapp",
        `${label}: request failed`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(label, {
        status: response.status,
        body: errorBody,
        ...context,
      });
      throw new WhatsAppApiError(label, response.status, errorBody);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      this.logger.error(label, {
        status: response.status,
        ...context,
        error,
      });
      throw new NetworkError(
        "whatsapp",
        `${label}: response was not valid JSON`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Resolve an emoji value to a unicode string.
   */
  protected resolveEmoji(emoji: EmojiValue | string): string {
    return defaultEmojiResolver.toGChat(emoji);
  }
}

/**
 * Factory function to create a WhatsApp adapter.
 *
 * @example
 * ```typescript
 * const adapter = createWhatsAppAdapter({
 *   accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
 *   appSecret: process.env.WHATSAPP_APP_SECRET!,
 *   phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
 *   verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
 * });
 * ```
 */
export function createWhatsAppAdapter(
  config?: WhatsAppAdapterConfig
): WhatsAppAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("whatsapp");

  const accessToken = config?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new ValidationError(
      "whatsapp",
      "accessToken is required. Set WHATSAPP_ACCESS_TOKEN or provide it in config."
    );
  }

  const appSecret = config?.appSecret ?? process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    throw new ValidationError(
      "whatsapp",
      "appSecret is required. Set WHATSAPP_APP_SECRET or provide it in config."
    );
  }

  const phoneNumberId =
    config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new ValidationError(
      "whatsapp",
      "phoneNumberId is required. Set WHATSAPP_PHONE_NUMBER_ID or provide it in config."
    );
  }

  const verifyToken = config?.verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new ValidationError(
      "whatsapp",
      "verifyToken is required. Set WHATSAPP_VERIFY_TOKEN or provide it in config."
    );
  }

  const userName =
    config?.userName ?? process.env.WHATSAPP_BOT_USERNAME ?? "whatsapp-bot";

  return new WhatsAppAdapter({
    accessToken,
    apiUrl: config?.apiUrl ?? process.env.WHATSAPP_API_URL,
    apiVersion: config?.apiVersion,
    appSecret,
    phoneNumberId,
    verifyToken,
    userName,
    logger,
  });
}
