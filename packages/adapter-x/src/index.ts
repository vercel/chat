import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  decodeKey,
  decryptToken,
  type EncryptedTokenData,
  encryptToken,
  extractCard,
  extractFiles,
  extractPostableAttachments,
  isEncryptedTokenData,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  StateAdapter,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
} from "chat";
import { cardToXText } from "./cards";
import { XFormatConverter } from "./markdown";
import type {
  XAccessToken,
  XActivityEnvelope,
  XActivityEvent,
  XAdapterConfig,
  XApiResponse,
  XDmEvent,
  XDmSendResult,
  XDmWireEvent,
  XMediaUploadResult,
  XOauthTokenResult,
  XPost,
  XPostCreateResult,
  XRawMessage,
  XStoredOauthToken,
  XThreadId,
  XUser,
} from "./types";

const DEFAULT_API_BASE_URL = "https://api.x.com";
const SIGNATURE_HEADER = "x-twitter-webhooks-signature";
const SIGNATURE_PREFIX = "sha256=";
const SENT_ID_LIMIT = 1000;
const DM_EVENT_FIELDS = "id,text,sender_id,created_at,dm_conversation_id";
const LIKE_EMOJI = new Set(["❤️", "♥️", "❤"]);
const LIKE_NAMES = new Set(["heart", "like", "red_heart"]);
/** Refresh the managed access token this long before it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 7200;
/** Channel ID for public post threads. */
const PUBLIC_CHANNEL_ID = "x:public";
const MEDIA_UPLOAD_PATH = "/2/media/upload";
const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_PER_POST = 4;

interface ManagedToken {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
}

export class XAdapter implements Adapter<XThreadId, XRawMessage> {
  readonly name = "x";
  readonly persistThreadHistory = true;

  protected readonly apiBaseUrl: string;
  protected readonly consumerSecret: string;
  protected readonly userAccessToken?: XAccessToken;
  protected readonly oauth?: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  };
  protected readonly encryptionKey: Buffer | undefined;
  protected readonly logger: Logger;
  protected readonly formatConverter = new XFormatConverter();

  protected chat: ChatInstance | null = null;
  protected _botUserId?: string;
  protected _userName: string;
  protected readonly hasExplicitUserName: boolean;

  /** IDs of posts and DM events created by this adapter, for isMe echo detection. */
  private readonly sentIds = new Set<string>();
  /** Latest inbound post ID per conversation, used as the reply target. */
  private readonly replyTargets = new Map<string, string>();
  private readonly messageCache = new Map<string, Message<XRawMessage>[]>();

  private managedToken: ManagedToken | null = null;
  private refreshPromise: Promise<string> | null = null;
  private storedTokenLoaded = false;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(
    config: XAdapterConfig & {
      consumerSecret: string;
      logger: Logger;
    }
  ) {
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.consumerSecret = config.consumerSecret;
    this.userAccessToken = config.userAccessToken;
    if (config.clientId && config.refreshToken) {
      this.oauth = {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      };
    }
    if (!(this.userAccessToken || this.oauth)) {
      throw new ValidationError(
        "x",
        "An access token is required. Provide userAccessToken, or clientId and refreshToken for managed OAuth refresh."
      );
    }
    this.encryptionKey = config.encryptionKey
      ? decodeKey(config.encryptionKey)
      : undefined;
    this.logger = config.logger;
    this._botUserId = config.userId;
    this._userName = config.userName ?? "bot";
    this.hasExplicitUserName = Boolean(config.userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      this._userName = chat.getUserName();
    }

    if (this._botUserId && this.hasExplicitUserName) {
      return;
    }

    try {
      const me = await this.xApiFetch<XUser>(
        "/2/users/me?user.fields=username",
        "GET"
      );
      if (me.data) {
        this._botUserId = this._botUserId ?? me.data.id;
        if (!this.hasExplicitUserName && me.data.username) {
          this._userName = me.data.username;
        }
      }
      this.logger.info("X adapter initialized", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch X bot identity", {
        error: String(error),
      });
    }

    // The bot id is required: DM threading keys on the other participant and
    // self-detection compares against it, so a missing id silently misroutes
    // the bot's own DMs. Fail fast rather than degrade in production.
    if (!this._botUserId) {
      throw new ValidationError(
        "x",
        "Could not resolve the bot user id. Set X_USER_ID, or ensure the access token has the users.read scope so it can be fetched from /2/users/me."
      );
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (request.method === "GET") {
      return this.handleCrcChallenge(request);
    }

    const body = await request.text();

    if (!this.verifySignature(request, body)) {
      this.logger.warn("X webhook rejected due to invalid signature");
      return new Response("Invalid signature", { status: 401 });
    }

    let envelope: XActivityEnvelope;
    try {
      envelope = JSON.parse(body) as XActivityEnvelope;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring X webhook");
      return new Response("OK", { status: 200 });
    }

    let events: XActivityEvent[] = [];
    if (Array.isArray(envelope.data)) {
      events = envelope.data;
    } else if (envelope.data) {
      events = [envelope.data];
    }

    for (const event of events) {
      this.routeActivityEvent(event, options);
    }

    return new Response("OK", { status: 200 });
  }

  /**
   * Answer X's challenge-response check: HMAC-SHA256 over `crc_token`,
   * keyed by the consumer secret, base64 encoded.
   */
  protected handleCrcChallenge(request: Request): Response {
    const crcToken = new URL(request.url).searchParams.get("crc_token");
    if (!crcToken) {
      return new Response("Missing crc_token", { status: 400 });
    }

    const hash = createHmac("sha256", this.consumerSecret)
      .update(crcToken, "utf8")
      .digest("base64");

    return Response.json({ response_token: `${SIGNATURE_PREFIX}${hash}` });
  }

  protected verifySignature(request: Request, body: string): boolean {
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!signature?.startsWith(SIGNATURE_PREFIX)) {
      return false;
    }

    const expected = createHmac("sha256", this.consumerSecret)
      .update(body, "utf8")
      .digest("base64");

    try {
      const provided = Buffer.from(
        signature.slice(SIGNATURE_PREFIX.length),
        "base64"
      );
      const computed = Buffer.from(expected, "base64");
      return (
        provided.length === computed.length &&
        timingSafeEqual(provided, computed)
      );
    } catch {
      this.logger.warn("Failed to verify X webhook signature");
      return false;
    }
  }

  protected routeActivityEvent(
    event: XActivityEvent,
    options?: WebhookOptions
  ): void {
    const users = event.includes?.users;
    switch (event.event_type) {
      case "post.mention.create": {
        const extracted = extractPost(event.payload, users);
        if (!extracted) {
          this.logger.warn("Unrecognized X mention payload shape");
          return;
        }
        this.handleIncomingPost(extracted.post, extracted.author, options);
        return;
      }
      case "dm.received":
      case "dm.sent": {
        const extracted = extractDmEvents(event.payload, users);
        if (extracted.length === 0) {
          this.logger.warn("Unrecognized X DM payload shape");
          return;
        }
        // A delivery can batch multiple message_create events; route each.
        for (const { dmEvent, sender } of extracted) {
          this.handleIncomingDm(dmEvent, sender, options);
        }
        return;
      }
      default:
        this.logger.debug("Ignoring X activity event", {
          eventType: event.event_type,
        });
    }
  }

  protected handleIncomingPost(
    post: XPost,
    author: XUser | undefined,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: post.conversation_id ?? post.id,
      kind: "post",
    });
    this.replyTargets.set(threadId, post.id);

    const message = this.buildPostMessage(
      { author, kind: "post", post },
      threadId,
      { isMention: true }
    );
    this.cacheMessage(message);
    this.chat.processMessage(this, threadId, message, options);
  }

  protected handleIncomingDm(
    dmEvent: XDmEvent,
    sender: XUser | undefined,
    options?: WebhookOptions
  ): void {
    const participant = this.otherParticipant(dmEvent);
    if (!(this.chat && participant)) {
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: participant,
      kind: "dm",
    });

    const message = this.buildDmMessage(
      { dmEvent, kind: "dm", sender },
      threadId
    );
    this.cacheMessage(message);
    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * The user id of the other party in a DM: the sender for inbound events,
   * the recipient for the bot's own outbound echoes. DM threads are keyed by
   * this id since X DM webhooks carry no conversation id.
   */
  protected otherParticipant(dmEvent: XDmEvent): string | undefined {
    const { sender_id, recipient_id } = dmEvent;
    if (this._botUserId && sender_id === this._botUserId) {
      return recipient_id;
    }
    return sender_id ?? recipient_id;
  }

  /**
   * Post to a thread. `x:post:` threads become a reply to the latest mention
   * in the conversation (chaining under the bot's own prior replies);
   * `x:dm:` threads send a direct message to the participant. Cards and
   * markdown are flattened to plain text; image, gif, and video attachments are
   * uploaded via the chunked media endpoint and attached to the post.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<XRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    const text = this.renderOutbound(message);
    const mediaIds = await this.uploadAttachments(message, decoded.kind);

    if (!(text.trim() || mediaIds.length > 0)) {
      throw new ValidationError("x", "Message must have text or media");
    }

    if (decoded.kind === "post") {
      return this.sendReply(threadId, decoded.conversationId, text, mediaIds);
    }
    return this.sendDm(threadId, decoded.conversationId, text, mediaIds);
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<XRawMessage>> {
    if (channelId !== PUBLIC_CHANNEL_ID) {
      throw new ValidationError(
        "x",
        `Top-level posts are only supported on the "${PUBLIC_CHANNEL_ID}" channel, got: ${channelId}`
      );
    }

    const text = this.renderOutbound(message);
    const mediaIds = await this.uploadAttachments(message, "post");
    if (!(text.trim() || mediaIds.length > 0)) {
      throw new ValidationError("x", "Message must have text or media");
    }

    const result = await this.xApiFetch<XPostCreateResult>(
      "/2/tweets",
      "POST",
      {
        ...(text.trim() ? { text } : {}),
        ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
      }
    );
    const post = this.requireData(result, "create post");
    this.trackSentId(post.id);

    const threadId = this.encodeThreadId({
      conversationId: post.id,
      kind: "post",
    });
    return this.finishSentPost(threadId, post.id, text);
  }

  protected async sendReply(
    threadId: string,
    conversationId: string,
    text: string,
    mediaIds: string[] = []
  ): Promise<RawMessage<XRawMessage>> {
    const replyTarget = this.replyTargets.get(threadId) ?? conversationId;
    const result = await this.xApiFetch<XPostCreateResult>(
      "/2/tweets",
      "POST",
      {
        reply: { in_reply_to_tweet_id: replyTarget },
        ...(text.trim() ? { text } : {}),
        ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
      }
    );
    const post = this.requireData(result, "create reply");
    this.trackSentId(post.id);
    // Keep threading under our own reply so consecutive posts chain naturally.
    this.replyTargets.set(threadId, post.id);
    return this.finishSentPost(threadId, post.id, text);
  }

  protected finishSentPost(
    threadId: string,
    postId: string,
    text: string
  ): RawMessage<XRawMessage> {
    const decoded = this.decodeThreadId(threadId);
    const raw: XRawMessage = {
      kind: "post",
      post: {
        author_id: this._botUserId,
        conversation_id: decoded.conversationId,
        created_at: new Date().toISOString(),
        id: postId,
        text,
      },
    };
    this.cacheMessage(this.buildPostMessage(raw, threadId, { isMe: true }));
    return { id: postId, raw, threadId };
  }

  protected async sendDm(
    threadId: string,
    participantId: string,
    text: string,
    mediaIds: string[] = []
  ): Promise<RawMessage<XRawMessage>> {
    // DM threads are keyed by the other participant, so send via the
    // documented by-participant endpoint. Inbound echoes for this
    // conversation arrive on the same participant-keyed thread.
    const result = await this.xApiFetch<XDmSendResult>(
      `/2/dm_conversations/with/${encodeURIComponent(participantId)}/messages`,
      "POST",
      {
        ...(text.trim() ? { text } : {}),
        ...(mediaIds.length > 0
          ? { attachments: mediaIds.map((id) => ({ media_id: id })) }
          : {}),
      }
    );
    const sent = this.requireData(result, "send DM");
    this.trackSentId(sent.dm_event_id);

    const raw: XRawMessage = {
      dmEvent: {
        created_timestamp: String(Date.now()),
        dm_conversation_id: sent.dm_conversation_id,
        id: sent.dm_event_id,
        recipient_id: participantId,
        sender_id: this._botUserId,
        text,
      },
      kind: "dm",
    };
    this.cacheMessage(this.buildDmMessage(raw, threadId));
    return { id: sent.dm_event_id, raw, threadId };
  }

  /**
   * Upload every attachment on the message via the chunked media endpoint and
   * return the resulting media IDs, ready to attach to a post or DM. Accepts
   * both `files` (FileUpload) and `attachments` (Attachment). X allows at most
   * {@link MAX_MEDIA_PER_POST} media per post.
   */
  protected async uploadAttachments(
    message: AdapterPostableMessage,
    surface: "dm" | "post"
  ): Promise<string[]> {
    const sources: { load: () => Promise<Buffer>; mimeType: string }[] = [];
    for (const file of extractFiles(message)) {
      sources.push({
        load: () => toBytes(file.data),
        mimeType: inferMediaType(file.mimeType, file.filename),
      });
    }
    for (const attachment of extractPostableAttachments(message)) {
      const load = attachment.data
        ? () => toBytes(attachment.data as Buffer | Blob)
        : attachment.fetchData;
      if (!load) {
        throw new ValidationError(
          "x",
          "Attachment has no data to upload (provide data or fetchData)"
        );
      }
      sources.push({
        load,
        mimeType: inferMediaType(attachment.mimeType, attachment.name),
      });
    }

    if (sources.length === 0) {
      return [];
    }
    if (sources.length > MAX_MEDIA_PER_POST) {
      throw new ValidationError(
        "x",
        `X allows at most ${MAX_MEDIA_PER_POST} media per post, got ${sources.length}`
      );
    }

    const mediaIds: string[] = [];
    for (const source of sources) {
      const bytes = await source.load();
      mediaIds.push(await this.uploadMedia(bytes, source.mimeType, surface));
    }
    return mediaIds;
  }

  /**
   * Upload one media file through the v2 chunked flow (INIT, APPEND, FINALIZE)
   * and return its media ID. Waits for server-side processing when X reports it
   * (video/gif); images are ready immediately.
   */
  protected async uploadMedia(
    bytes: Buffer,
    mimeType: string,
    surface: "dm" | "post"
  ): Promise<string> {
    // v2 chunked upload is path-based: initialize (JSON) then one or more
    // multipart appends, then finalize (JSON). Images finalize synchronously.
    const init = await this.xApiFetch<XMediaUploadResult>(
      `${MEDIA_UPLOAD_PATH}/initialize`,
      "POST",
      {
        media_category: mediaCategory(mimeType, surface),
        media_type: mimeType,
        total_bytes: bytes.length,
      }
    );
    const mediaId = this.requireData(init, "media upload initialize").id;

    let segment = 0;
    for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + MEDIA_CHUNK_BYTES);
      const form = new FormData();
      form.append("segment_index", String(segment));
      form.append(
        "media",
        new Blob([new Uint8Array(chunk)], { type: mimeType }),
        "chunk"
      );
      await this.xMediaAppend(mediaId, form);
      segment += 1;
    }

    const finalized = this.requireData(
      await this.xApiFetch<XMediaUploadResult>(
        `${MEDIA_UPLOAD_PATH}/${encodeURIComponent(mediaId)}/finalize`,
        "POST"
      ),
      "media upload finalize"
    );
    const state = finalized.processing_info?.state;
    if (state && state !== "succeeded") {
      throw new ValidationError(
        "x",
        `X media ${mediaId} needs async processing (state: ${state}); the X adapter supports image uploads only`
      );
    }
    return mediaId;
  }

  /** Upload one chunk to an initialized media id (multipart append). */
  protected async xMediaAppend(mediaId: string, form: FormData): Promise<void> {
    const token = await this.resolveAccessToken();
    const path = `${MEDIA_UPLOAD_PATH}/${encodeURIComponent(mediaId)}/append`;
    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        body: form,
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
    } catch (error) {
      throw new NetworkError(
        "x",
        "Network error uploading X media chunk",
        error instanceof Error ? error : undefined
      );
    }
    if (!response.ok) {
      this.throwApiError(path, response, await readMediaResponse(response));
    }
  }

  /**
   * Edit an owned post via `edit_options.previous_post_id`.
   *
   * X post editing has account-level eligibility and recency rules; requests
   * outside them fail with the API's own error. The edited post gets a new ID.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<XRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    if (decoded.kind !== "post") {
      throw new ValidationError("x", "X does not support editing DMs");
    }

    const text = this.renderOutbound(message);
    if (!text.trim()) {
      throw new ValidationError("x", "Message text cannot be empty");
    }

    const result = await this.xApiFetch<XPostCreateResult>(
      "/2/tweets",
      "POST",
      {
        edit_options: { previous_post_id: messageId },
        text,
      }
    );
    const post = this.requireData(result, "edit post");
    this.trackSentId(post.id);
    return this.finishSentPost(threadId, post.id, text);
  }

  /**
   * Delete a message. Posts are deleted via `DELETE /2/tweets/:id`; DM events
   * via `DELETE /2/dm_events/:id`, which removes the event for the
   * authenticated user only, not for the other participant.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const decoded = this.decodeThreadId(threadId);
    if (decoded.kind !== "post") {
      // Deletes the event for the authenticated user only, not other participants.
      await this.xApiFetch(
        `/2/dm_events/${encodeURIComponent(messageId)}`,
        "DELETE"
      );
      return;
    }
    await this.xApiFetch(
      `/2/tweets/${encodeURIComponent(messageId)}`,
      "DELETE"
    );
  }

  /**
   * Likes are the only reaction X exposes. Accepts the heart emoji or the
   * names "heart" / "like"; everything else is rejected.
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    this.assertLikeReaction(threadId, emoji);
    const userId = this.requireBotUserId("add reactions");
    await this.xApiFetch(`/2/users/${userId}/likes`, "POST", {
      tweet_id: messageId,
    });
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    this.assertLikeReaction(threadId, emoji);
    const userId = this.requireBotUserId("remove reactions");
    await this.xApiFetch(
      `/2/users/${userId}/likes/${encodeURIComponent(messageId)}`,
      "DELETE"
    );
  }

  protected assertLikeReaction(
    threadId: string,
    emoji: EmojiValue | string
  ): void {
    const decoded = this.decodeThreadId(threadId);
    if (decoded.kind !== "post") {
      throw new ValidationError("x", "X does not support reactions on DMs");
    }

    const name = typeof emoji === "string" ? emoji.toLowerCase() : "";
    const unicode = defaultEmojiResolver.toGChat(emoji);
    if (!(LIKE_EMOJI.has(unicode) || LIKE_NAMES.has(name))) {
      throw new ValidationError(
        "x",
        'X only supports likes. Use emoji.heart or "like".'
      );
    }
  }

  async startTyping(_threadId: string): Promise<void> {
    // X has no outbound typing indicator API.
    this.logger.debug("startTyping is not supported on X");
  }

  /**
   * Buffer the stream and post once on completion.
   *
   * This intentionally overrides Chat SDK's post+edit fallback: incremental
   * edits of public posts are rate-limited, eligibility-gated, and read as
   * noisy automation under X policy.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<XRawMessage>> {
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
   * Fetch thread messages. DM threads are read live from the by-participant
   * DM-events endpoint; post threads are served from the inbound cache, since
   * X has no public thread-history read (persistThreadHistory backs longer
   * retention).
   */
  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<XRawMessage>> {
    const decoded = this.decodeThreadId(threadId);

    if (decoded.kind === "post") {
      const messages = [...(this.messageCache.get(threadId) ?? [])].sort(
        compareByDate
      );
      return paginateMessages(messages, options);
    }

    return this.fetchDmMessages(threadId, decoded, options);
  }

  protected async fetchDmMessages(
    threadId: string,
    decoded: XThreadId,
    options: FetchOptions
  ): Promise<FetchResult<XRawMessage>> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const params = new URLSearchParams({
      "dm_event.fields": DM_EVENT_FIELDS,
      event_types: "MessageCreate",
      max_results: String(limit),
    });
    if (options.cursor) {
      params.set("pagination_token", options.cursor);
    }

    // DM threads are participant-keyed, so read via the by-participant
    // endpoint. This REST lookup returns v2-shaped events (flat, ISO
    // `created_at`), distinct from the legacy webhook shape.
    const result = await this.xApiFetch<XDmEvent[]>(
      `/2/dm_conversations/with/${encodeURIComponent(decoded.conversationId)}/dm_events?${params.toString()}`,
      "GET"
    );

    const events = result.data ?? [];
    const messages = events
      .map((dmEvent) => this.buildDmMessage({ dmEvent, kind: "dm" }, threadId))
      .sort(compareByDate);

    return { messages, nextCursor: result.meta?.next_token };
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<XRawMessage> | null> {
    const cached = this.findCachedMessage(messageId);
    if (cached) {
      return cached;
    }

    const decoded = this.decodeThreadId(threadId);
    if (decoded.kind !== "post") {
      return null;
    }

    try {
      const params = new URLSearchParams({
        expansions: "author_id",
        "tweet.fields": "author_id,conversation_id,created_at",
        "user.fields": "name,username",
      });
      const result = await this.xApiFetch<XPost>(
        `/2/tweets/${encodeURIComponent(messageId)}?${params.toString()}`,
        "GET"
      );
      if (!result.data) {
        return null;
      }
      const author = result.includes?.users?.find(
        (user) => user.id === result.data?.author_id
      );
      return this.buildPostMessage(
        { author, kind: "post", post: result.data },
        threadId,
        {}
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    return {
      channelId: this.channelIdFromThreadId(threadId),
      id: threadId,
      isDM: decoded.kind !== "post",
      metadata: { conversationId: decoded.conversationId, kind: decoded.kind },
    };
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    try {
      const params = new URLSearchParams({
        "user.fields": "name,username,profile_image_url",
      });
      const result = await this.xApiFetch<XUser>(
        `/2/users/${encodeURIComponent(userId)}?${params.toString()}`,
        "GET"
      );
      if (!result.data) {
        return null;
      }
      return {
        avatarUrl: result.data.profile_image_url,
        fullName: result.data.name ?? result.data.username ?? result.data.id,
        isBot: false,
        userId: result.data.id,
        userName: result.data.username ?? result.data.id,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * DM threads are keyed by the other participant's user id, since X DM
   * webhooks carry no conversation id. Sends and inbound events for the same
   * user therefore share one thread.
   */
  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({ conversationId: userId, kind: "dm" });
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).kind === "dm";
  }

  encodeThreadId(platformData: XThreadId): string {
    return `x:${platformData.kind}:${platformData.conversationId}`;
  }

  decodeThreadId(threadId: string): XThreadId {
    const parts = threadId.split(":");
    const kind = parts[1];
    const conversationId = parts.slice(2).join(":");
    if (
      parts[0] !== "x" ||
      (kind !== "post" && kind !== "dm") ||
      !conversationId
    ) {
      throw new ValidationError("x", `Invalid X thread ID: ${threadId}`);
    }
    return { conversationId, kind };
  }

  /**
   * Public post threads share the `x:public` channel; DM threads are their
   * own channel (a DM conversation has no broader container on X).
   */
  channelIdFromThreadId(threadId: string): string {
    const decoded = this.decodeThreadId(threadId);
    return decoded.kind === "post" ? PUBLIC_CHANNEL_ID : threadId;
  }

  parseMessage(raw: XRawMessage): Message<XRawMessage> {
    if (raw.kind === "dm") {
      const participant = this.otherParticipant(raw.dmEvent) ?? raw.dmEvent.id;
      const threadId = this.encodeThreadId({
        conversationId: participant,
        kind: "dm",
      });
      const message = this.buildDmMessage(raw, threadId);
      this.cacheMessage(message);
      return message;
    }

    const threadId = this.encodeThreadId({
      conversationId: raw.post.conversation_id ?? raw.post.id,
      kind: "post",
    });
    const message = this.buildPostMessage(raw, threadId, {});
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  protected renderOutbound(message: AdapterPostableMessage): string {
    const card = extractCard(message);
    const text = card
      ? cardToXText(card)
      : this.formatConverter.renderPostable(message);
    return convertEmojiPlaceholders(text, "x");
  }

  protected buildPostMessage(
    raw: Extract<XRawMessage, { kind: "post" }>,
    threadId: string,
    flags: { isMe?: boolean; isMention?: boolean }
  ): Message<XRawMessage> {
    const { post, author } = raw;
    const isMe = flags.isMe ?? this.isSelf(post.id);
    return new Message<XRawMessage>({
      attachments: [],
      author: this.buildAuthor(post.author_id, author, isMe),
      formatted: this.formatConverter.toAst(post.text),
      id: post.id,
      isMention: flags.isMention ?? false,
      metadata: {
        dateSent: post.created_at ? new Date(post.created_at) : new Date(),
        edited: false,
      },
      raw,
      text: post.text,
      threadId,
    });
  }

  protected buildDmMessage(
    raw: Extract<XRawMessage, { kind: "dm" }>,
    threadId: string
  ): Message<XRawMessage> {
    const { dmEvent, sender } = raw;
    const text = dmEvent.text ?? "";
    // A DM is self when this adapter sent it (tracked id) or when the sender is
    // the bot account. The latter is stateless, so dm.sent echoes are filtered
    // even on a cold start or a different serverless instance, avoiding reply
    // loops where the bot's own DM would otherwise route as inbound.
    const isMe = this.isSelf(dmEvent.id) || this.isBotSender(dmEvent.sender_id);
    return new Message<XRawMessage>({
      attachments: [],
      author: this.buildAuthor(dmEvent.sender_id, sender, isMe),
      formatted: this.formatConverter.toAst(text),
      id: dmEvent.id,
      isMention: false,
      metadata: {
        dateSent: dmTimestamp(dmEvent),
        edited: false,
      },
      raw,
      text,
      threadId,
    });
  }

  /**
   * Only events echoing IDs this adapter created are `isMe`. Other activity
   * from the bot's own account (for example manual posts by the account
   * owner) still flows through routing so handlers can decide what to do.
   */
  protected isSelf(messageId: string): boolean {
    return this.sentIds.has(messageId);
  }

  /** Whether a sender id is the bot account (stateless self-detection). */
  protected isBotSender(senderId: string | undefined): boolean {
    return Boolean(this._botUserId && senderId === this._botUserId);
  }

  protected buildAuthor(
    userId: string | undefined,
    user: XUser | undefined,
    isMe: boolean
  ): Author {
    const id = userId ?? user?.id ?? "unknown";
    const userName = isMe
      ? this._userName
      : (user?.username ?? user?.name ?? id);
    return {
      fullName: user?.name ?? userName,
      isBot: isMe,
      isMe,
      userId: id,
      userName,
    };
  }

  protected requireBotUserId(action: string): string {
    if (!this._botUserId) {
      throw new ValidationError(
        "x",
        `The bot user ID is required to ${action}. Set X_USER_ID or grant users.read so it can be fetched.`
      );
    }
    return this._botUserId;
  }

  protected requireData<TData>(
    result: XApiResponse<TData>,
    action: string
  ): TData {
    if (!result.data) {
      throw new ValidationError("x", `X API returned no data for ${action}`);
    }
    return result.data;
  }

  protected trackSentId(id: string): void {
    this.sentIds.add(id);
    if (this.sentIds.size > SENT_ID_LIMIT) {
      const oldest = this.sentIds.values().next().value;
      if (oldest) {
        this.sentIds.delete(oldest);
      }
    }
  }

  protected cacheMessage(message: Message<XRawMessage>): void {
    const existing = this.messageCache.get(message.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }
    existing.sort(compareByDate);
    this.messageCache.set(message.threadId, existing);
  }

  protected findCachedMessage(
    messageId: string
  ): Message<XRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  protected async resolveAccessToken(): Promise<string> {
    if (typeof this.userAccessToken === "function") {
      return await this.userAccessToken();
    }
    if (this.oauth) {
      return this.resolveManagedToken();
    }
    if (this.userAccessToken) {
      return this.userAccessToken;
    }
    throw new AuthenticationError("x", "No X access token configured");
  }

  private async resolveManagedToken(): Promise<string> {
    const current = await this.loadManagedToken();
    if (
      current?.accessToken &&
      current.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return current.accessToken;
    }
    // Single-flight so concurrent API calls share one refresh. X rotates
    // refresh tokens, so a duplicate refresh would invalidate the other.
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshManagedToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async loadManagedToken(): Promise<ManagedToken | null> {
    if (!this.oauth) {
      return null;
    }
    if (!(this.managedToken || this.storedTokenLoaded)) {
      const state = this.tryGetState();
      if (state) {
        this.storedTokenLoaded = true;
        this.managedToken = await this.readStoredToken(state);
      }
    }
    if (!this.managedToken) {
      this.managedToken = {
        accessToken: "",
        expiresAt: 0,
        refreshToken: this.oauth.refreshToken,
      };
    }
    return this.managedToken;
  }

  private async refreshManagedToken(): Promise<string> {
    const oauth = this.oauth;
    if (!oauth) {
      throw new AuthenticationError("x", "Managed OAuth is not configured");
    }
    const current = await this.loadManagedToken();
    const refreshToken = current?.refreshToken ?? oauth.refreshToken;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (oauth.clientSecret) {
      const basic = Buffer.from(
        `${oauth.clientId}:${oauth.clientSecret}`
      ).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    } else {
      body.set("client_id", oauth.clientId);
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}/2/oauth2/token`, {
        body: body.toString(),
        headers,
        method: "POST",
      });
    } catch (error) {
      throw new NetworkError(
        "x",
        "Network error refreshing X access token",
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new AuthenticationError(
        "x",
        `Failed to refresh X access token (status ${response.status}). The refresh token may have been revoked or already rotated.`
      );
    }

    let result: XOauthTokenResult;
    try {
      result = (await response.json()) as XOauthTokenResult;
    } catch {
      throw new AuthenticationError(
        "x",
        "Failed to parse X token refresh response"
      );
    }
    if (!result.access_token) {
      throw new AuthenticationError(
        "x",
        "X token refresh response did not include an access token"
      );
    }

    this.managedToken = {
      accessToken: result.access_token,
      expiresAt:
        Date.now() + (result.expires_in ?? DEFAULT_TOKEN_LIFETIME_S) * 1000,
      // X rotates refresh tokens; persist the new one or auth breaks after restart.
      refreshToken: result.refresh_token ?? refreshToken,
    };
    await this.persistManagedToken(this.managedToken);
    return this.managedToken.accessToken;
  }

  private tokenStateKey(): string {
    return `x:oauth:${this.oauth?.clientId}`;
  }

  private tryGetState(): StateAdapter | null {
    try {
      return this.chat?.getState() ?? null;
    } catch {
      return null;
    }
  }

  private async readStoredToken(
    state: StateAdapter
  ): Promise<ManagedToken | null> {
    try {
      const stored = await state.get<XStoredOauthToken>(this.tokenStateKey());
      if (!stored) {
        return null;
      }
      return {
        accessToken: this.revealToken(stored.accessToken),
        expiresAt: stored.expiresAt,
        refreshToken: this.revealToken(stored.refreshToken),
      };
    } catch (error) {
      this.logger.warn("Failed to read stored X OAuth token", {
        error: String(error),
      });
      return null;
    }
  }

  private async persistManagedToken(token: ManagedToken): Promise<void> {
    const state = this.tryGetState();
    if (!state) {
      return;
    }
    try {
      const stored: XStoredOauthToken = {
        accessToken: this.concealToken(token.accessToken),
        expiresAt: token.expiresAt,
        refreshToken: this.concealToken(token.refreshToken),
      };
      await state.set(this.tokenStateKey(), stored);
    } catch (error) {
      this.logger.warn("Failed to persist X OAuth token", {
        error: String(error),
      });
    }
  }

  private concealToken(value: string): EncryptedTokenData | string {
    return this.encryptionKey ? encryptToken(value, this.encryptionKey) : value;
  }

  private revealToken(value: EncryptedTokenData | string): string {
    if (isEncryptedTokenData(value)) {
      if (!this.encryptionKey) {
        throw new AuthenticationError(
          "x",
          "Stored X token is encrypted but no encryptionKey is configured"
        );
      }
      return decryptToken(value, this.encryptionKey);
    }
    return value;
  }

  protected async xApiFetch<TData>(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: Record<string, unknown>
  ): Promise<XApiResponse<TData>> {
    const token = await this.resolveAccessToken();

    const init: RequestInit = {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method,
    };
    if (body) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, init);
    } catch (error) {
      throw new NetworkError(
        "x",
        `Network error calling X API ${path}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: XApiResponse<TData> | undefined;
    try {
      data = (await response.json()) as XApiResponse<TData>;
    } catch {
      data = undefined;
    }

    if (!response.ok) {
      this.throwApiError(path, response, data);
    }

    if (!data) {
      throw new NetworkError("x", `Failed to parse X API response for ${path}`);
    }

    if (data.errors?.length && data.data) {
      // X can return partial successes with both data and errors.
      this.logger.warn("X API returned partial errors", {
        errors: data.errors,
        path,
      });
    } else if (data.errors?.length) {
      throw new ValidationError(
        "x",
        apiErrorMessage(data.errors) ?? `X API ${path} failed`
      );
    }

    return data;
  }

  protected throwApiError(
    path: string,
    response: Response,
    data: XApiResponse<unknown> | undefined
  ): never {
    const message =
      apiErrorMessage(data?.errors) ??
      `X API ${path} failed with status ${response.status}`;

    if (response.status === 429) {
      throw new AdapterRateLimitError("x", retryAfterSeconds(response));
    }
    if (response.status === 401) {
      throw new AuthenticationError("x", message);
    }
    if (response.status === 403) {
      throw new PermissionError("x", `call ${path}: ${message}`);
    }
    if (response.status === 404) {
      throw new ResourceNotFoundError("x", "resource", path);
    }
    if (response.status >= 400 && response.status < 500) {
      throw new ValidationError("x", message);
    }
    throw new NetworkError("x", `${message} (status ${response.status})`);
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
  webp: "image/webp",
};

async function toBytes(data: Buffer | Blob | ArrayBuffer): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  throw new ValidationError("x", "Unsupported attachment data type");
}

function mediaCategory(mimeType: string, surface: "dm" | "post"): string {
  if (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp"
  ) {
    // DM attachments must be registered as dm_image; X rejects a tweet_image
    // media_id attached to a DM event with "unsupported media category".
    return surface === "dm" ? "dm_image" : "tweet_image";
  }
  throw new ValidationError(
    "x",
    `X adapter supports image uploads (png, jpeg, webp); got ${mimeType}`
  );
}

function inferMediaType(
  mimeType: string | undefined,
  name: string | undefined
): string {
  if (mimeType) {
    return mimeType;
  }
  const extension = name?.split(".").pop()?.toLowerCase();
  const inferred = extension ? MIME_BY_EXTENSION[extension] : undefined;
  if (!inferred) {
    throw new ValidationError(
      "x",
      `Cannot determine media type${name ? ` for "${name}"` : ""}; set mimeType`
    );
  }
  return inferred;
}

async function readMediaResponse(
  response: Response
): Promise<XApiResponse<XMediaUploadResult> | undefined> {
  try {
    return (await response.json()) as XApiResponse<XMediaUploadResult>;
  } catch {
    return undefined;
  }
}

function apiErrorMessage(
  errors: { detail?: string; message?: string; title?: string }[] | undefined
): string | undefined {
  const first = errors?.[0];
  return first?.detail ?? first?.message ?? first?.title;
}

function retryAfterSeconds(response: Response): number | undefined {
  const reset = response.headers.get("x-rate-limit-reset");
  if (!reset) {
    return undefined;
  }
  const resetEpoch = Number.parseInt(reset, 10);
  if (Number.isNaN(resetEpoch)) {
    return undefined;
  }
  return Math.max(0, resetEpoch - Math.floor(Date.now() / 1000));
}

function compareByDate(
  a: Message<XRawMessage>,
  b: Message<XRawMessage>
): number {
  return a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
}

function paginateMessages(
  messages: Message<XRawMessage>[],
  options: FetchOptions
): FetchResult<XRawMessage> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const direction = options.direction ?? "backward";

  if (messages.length === 0) {
    return { messages: [] };
  }

  const indexById = new Map(
    messages.map((message, index) => [message.id, index])
  );

  if (direction === "backward") {
    const end =
      options.cursor && indexById.has(options.cursor)
        ? (indexById.get(options.cursor) ?? messages.length)
        : messages.length;
    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);
    return { messages: page, nextCursor: start > 0 ? page[0]?.id : undefined };
  }

  const start =
    options.cursor && indexById.has(options.cursor)
      ? (indexById.get(options.cursor) ?? -1) + 1
      : 0;
  const end = Math.min(messages.length, start + limit);
  const page = messages.slice(start, end);
  return {
    messages: page,
    nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeUser(value: unknown): value is XUser {
  return isRecord(value) && typeof value.id === "string";
}

function looksLikePost(value: unknown): value is XPost {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string"
  );
}

function dmTimestamp(dmEvent: XDmEvent): Date {
  if (dmEvent.created_timestamp) {
    const ms = Number.parseInt(dmEvent.created_timestamp, 10);
    if (!Number.isNaN(ms)) {
      return new Date(ms);
    }
  }
  if (dmEvent.created_at) {
    return new Date(dmEvent.created_at);
  }
  return new Date();
}

function findUser(
  users: readonly XUser[] | undefined,
  id: string | undefined
): XUser | undefined {
  if (!(users && id)) {
    return undefined;
  }
  return users.find((user) => user.id === id);
}

/**
 * Extract the post and its author from a `post.mention.create` payload.
 *
 * The Activity API delivers the post object directly as the payload and
 * references the author by `author_id`; the hydrated author lives in the
 * event's `includes.users`. An inline `author`/`user` on the payload is
 * accepted as a fallback for shapes that embed it.
 */
export function extractPost(
  payload: unknown,
  users?: readonly XUser[]
): { author?: XUser; post: XPost } | null {
  const post = unwrapPost(payload);
  if (!post) {
    return null;
  }
  const inline = isRecord(payload)
    ? (payload.author ?? payload.user)
    : undefined;
  const author =
    findUser(users, post.author_id) ??
    (looksLikeUser(inline) ? inline : undefined);
  return { author, post };
}

function unwrapPost(payload: unknown): XPost | null {
  if (looksLikePost(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return null;
  }
  for (const key of ["post", "tweet", "data"]) {
    if (looksLikePost(payload[key])) {
      return payload[key] as XPost;
    }
  }
  return null;
}

/**
 * Extract every message and its sender from a DM Activity payload.
 *
 * DMs use the legacy Account Activity shape: `direct_message_events[]` of
 * `message_create` items, with hydrated users in a `users` map keyed by id.
 * A single delivery can batch multiple events, so all `message_create` items
 * are returned in order. There is no conversation id on the wire, so callers
 * thread by participant. The `users` argument (mention-style `includes.users`)
 * is accepted as a fallback for any delivery that uses the v2 expansion shape.
 */
export function extractDmEvents(
  payload: unknown,
  users?: readonly XUser[]
): { dmEvent: XDmEvent; sender?: XUser }[] {
  if (!isRecord(payload)) {
    return [];
  }
  const events = payload.direct_message_events;
  if (!Array.isArray(events)) {
    return [];
  }
  const map = isRecord(payload.users)
    ? (payload.users as Record<string, { data?: XUser }>)
    : undefined;

  const results: { dmEvent: XDmEvent; sender?: XUser }[] = [];
  for (const wire of events as XDmWireEvent[]) {
    if (!wire?.message_create) {
      continue;
    }
    const create = wire.message_create;
    const dmEvent: XDmEvent = {
      created_timestamp: wire.created_timestamp,
      id: wire.id,
      recipient_id: create.target?.recipient_id,
      sender_id: create.sender_id,
      text: create.message_data?.text,
    };
    const mapped =
      dmEvent.sender_id && map ? map[dmEvent.sender_id]?.data : undefined;
    results.push({
      dmEvent,
      sender: mapped ?? findUser(users, dmEvent.sender_id),
    });
  }
  return results;
}

export function createXAdapter(config?: XAdapterConfig): XAdapter {
  const consumerSecret =
    config?.consumerSecret ?? process.env.X_CONSUMER_SECRET;
  if (!consumerSecret) {
    throw new ValidationError(
      "x",
      "consumerSecret is required. Set X_CONSUMER_SECRET or provide it in config."
    );
  }

  const clientId = config?.clientId ?? process.env.X_CLIENT_ID;
  const refreshToken = config?.refreshToken ?? process.env.X_REFRESH_TOKEN;
  const userAccessToken =
    config?.userAccessToken ?? process.env.X_USER_ACCESS_TOKEN;
  if (!(userAccessToken || (clientId && refreshToken))) {
    throw new ValidationError(
      "x",
      "An access token is required. Set X_USER_ACCESS_TOKEN, or set X_CLIENT_ID and X_REFRESH_TOKEN for managed OAuth refresh."
    );
  }

  return new XAdapter({
    apiBaseUrl: config?.apiBaseUrl ?? process.env.X_API_BASE_URL,
    clientId,
    clientSecret: config?.clientSecret ?? process.env.X_CLIENT_SECRET,
    consumerSecret,
    encryptionKey: config?.encryptionKey ?? process.env.X_ENCRYPTION_KEY,
    logger: config?.logger ?? new ConsoleLogger("info").child("x"),
    refreshToken,
    userAccessToken,
    userId: config?.userId ?? process.env.X_USER_ID,
    userName: config?.userName ?? process.env.X_USERNAME,
  });
}

export { cardToXText } from "./cards";
export { XFormatConverter } from "./markdown";
export type {
  XAccessToken,
  XActivityEnvelope,
  XActivityEvent,
  XAdapterConfig,
  XApiError,
  XApiResponse,
  XDmEvent,
  XDmSendResult,
  XOauthTokenResult,
  XPost,
  XPostCreateResult,
  XRawMessage,
  XStoredOauthToken,
  XThreadId,
  XUser,
} from "./types";
