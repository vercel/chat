/**
 * Email adapter for Chat SDK.
 *
 * Owns the email-shaped behavior — RFC-822 threading, MIME composition,
 * HTML/text rendering — and delegates outbound sending and inbound
 * webhook parsing to a pluggable {@link EmailProvider}.
 */

import { extractCard, ValidationError } from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  PostableAst,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  Message,
  NotImplementedError,
  parseMarkdown,
  stringifyMarkdown,
} from "chat";
import { EmailFormatConverter } from "./markdown";
import { cardToHtml, cardToPlainText, markdownToHtml } from "./render";
import {
  buildReferencesChain,
  decodeEmailThreadId,
  encodeEmailThreadId,
  findThreadRoot,
  generateMessageId,
  replySubject,
  stripAngleBrackets,
} from "./threading";
import type {
  EmailInbound,
  EmailRawMessage,
  EmailSendResult,
  EmailThreadId,
  EmailTransport,
  OutboundEmail,
  ParsedInboundEmail,
} from "./types";

/**
 * Internal state stored per thread. Used to construct the `References`
 * chain for outbound replies and to remember the original subject line.
 */
interface EmailThreadState {
  /** Last known participant address. */
  participantAddress?: string;
  /** Message-IDs in chronological order (oldest first). */
  references: string[];
  /** Subject from the most recent message in the thread. */
  subject?: string;
}

const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Email implementation of the Chat SDK {@link Adapter} contract.
 *
 * Use {@link createEmailAdapter} to construct instances — the constructor
 * deliberately takes a single fully-resolved options object so the factory
 * can apply env-var lookups, default the `messageIdDomain` from the From
 * address, and validate that at least one transport is configured.
 *
 * @template TThreadId - {@link EmailThreadId} — decoded `email:<root>:<addr>` thread IDs.
 * @template TRawMessage - {@link EmailRawMessage} — discriminated union of the inbound or outbound payload for each {@link Message}.
 *
 * @see {@link createEmailAdapter} for the public factory.
 * @see {@link EmailProvider} for the contract every ESP integration implements.
 */
export class EmailAdapter implements Adapter<EmailThreadId, EmailRawMessage> {
  /** Adapter discriminator used by `chat.webhooks.<name>` routing. */
  readonly name = "email";
  /** Email is 1:1, so thread-level locking is correct. */
  readonly lockScope = "thread" as const;
  /** Bot username surfaced through {@link Adapter.userName}. */
  readonly userName: string;

  /** Reference to the host {@link ChatInstance}, set during {@link initialize}. */
  protected chat: ChatInstance | null = null;
  /** Namespaced logger; defaults to `ConsoleLogger("info").child("email")`. */
  protected readonly logger: Logger;
  /** Mailbox the bot sends from (the `From` address). */
  protected readonly fromAddress: string;
  /** Optional display name shown in the `From` header. */
  protected readonly fromName?: string;
  /** Optional `Reply-To` override for outbound messages. */
  protected readonly replyToAddress?: string;
  /** Domain used as the `@domain` suffix on generated `Message-ID` headers. */
  protected readonly messageIdDomain: string;
  /** Provider-supplied outbound transport. Undefined produces a send-disabled adapter. */
  protected readonly transport?: EmailTransport;
  /** Provider-supplied inbound parser. Undefined produces a receive-disabled adapter. */
  protected readonly inbound?: EmailInbound;
  /** Markdown ↔ AST converter; canonical outbound rendering happens in {@link cardToHtml} / {@link markdownToHtml}. */
  protected readonly formatConverter = new EmailFormatConverter();

  /**
   * The bot's "user ID" is its From address — used for self-message
   * detection when an inbound parser surfaces an outbound copy.
   */
  get botUserId(): string {
    return this.fromAddress;
  }

  /**
   * Construct an `EmailAdapter`. Prefer {@link createEmailAdapter} unless
   * you need to bypass env-var lookups and the auto-derived messageIdDomain.
   */
  constructor(config: {
    fromAddress: string;
    fromName?: string;
    replyToAddress?: string;
    messageIdDomain: string;
    transport?: EmailTransport;
    inbound?: EmailInbound;
    userName: string;
    logger: Logger;
  }) {
    this.fromAddress = config.fromAddress;
    this.fromName = config.fromName;
    this.replyToAddress = config.replyToAddress;
    this.messageIdDomain = config.messageIdDomain;
    this.transport = config.transport;
    this.inbound = config.inbound;
    this.userName = config.userName;
    this.logger = config.logger;
  }

  /**
   * Wire the adapter to its host {@link ChatInstance}. Called once during
   * `new Chat({...})` construction; not part of the public API.
   */
  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Email adapter initialized", {
      fromAddress: this.fromAddress,
      transport: this.transport?.name ?? null,
      inbound: this.inbound?.name ?? null,
    });
    await Promise.resolve();
  }

  // ===========================================================================
  // Webhook handling
  // ===========================================================================

  /**
   * Handle an inbound webhook from the configured provider.
   *
   * Response codes:
   * - `404` — no inbound provider is configured (the adapter is send-only).
   * - `401` — signature verification failed.
   * - `400` — provider's `parse` threw (malformed JSON, missing fields, etc.).
   * - `500` — dispatch into the host {@link ChatInstance} failed (state error, etc.).
   * - `200` — dispatched successfully, or the event was a non-message
   *   notification that the provider chose to skip.
   *
   * Pre-`initialize()` calls return `200` so the platform doesn't retry
   * during cold starts.
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (!this.inbound) {
      this.logger.debug(
        "Inbound webhook received but no inbound provider configured"
      );
      return new Response("Not configured", { status: 404 });
    }

    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring email webhook");
      return new Response("ok", { status: 200 });
    }

    const body = await request.text();
    const verified = await this.inbound.verifySignature(request, body);
    if (!verified) {
      this.logger.warn("Email webhook rejected: invalid signature", {
        provider: this.inbound.name,
      });
      return new Response("Invalid signature", { status: 401 });
    }

    let parsed: ParsedInboundEmail | null;
    try {
      parsed = await this.inbound.parse(request, body);
    } catch (error) {
      this.logger.error("Email inbound parse failed", {
        error,
        provider: this.inbound.name,
      });
      return new Response("Invalid payload", { status: 400 });
    }

    if (!parsed) {
      // Provider chose to skip this event (e.g. delivery confirmations).
      return new Response("ok", { status: 200 });
    }

    try {
      await this.dispatchInbound(parsed, options);
    } catch (error) {
      this.logger.error("Email inbound dispatch failed", { error });
      return new Response("Internal error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Persist thread state for a parsed inbound email and dispatch the
   * resulting {@link Message} into the host {@link ChatInstance}.
   *
   * The thread root is resolved from RFC-822 `References` / `In-Reply-To`
   * headers; if neither is present, the inbound message becomes the new
   * thread root.
   */
  protected async dispatchInbound(
    parsed: ParsedInboundEmail,
    options: WebhookOptions | undefined
  ): Promise<void> {
    // handleWebhook guards against a null chat before reaching here, so
    // we can assert non-null and treat any divergence as a programmer
    // error rather than a runtime case to handle.
    const chat = this.chat as ChatInstance;

    const messageId = stripAngleBrackets(parsed.messageId);
    const inReplyTo = parsed.inReplyTo
      ? stripAngleBrackets(parsed.inReplyTo)
      : undefined;
    const references = (parsed.references ?? []).map(stripAngleBrackets);

    // Find the thread root. If there's no prior thread context, this
    // message becomes the new root.
    const discoveredRoot = findThreadRoot({ references, inReplyTo });
    const rootMessageId = discoveredRoot ?? messageId;

    const participantAddress = parsed.from.address;
    const threadId = encodeEmailThreadId({
      rootMessageId,
      participantAddress,
    });

    // Persist the latest reference chain + subject + participant for this
    // thread so future outbound replies thread correctly.
    const newState: EmailThreadState = {
      references: [...references, messageId],
      subject: parsed.subject,
      participantAddress,
    };
    await chat
      .getState()
      .set(this.threadStateKey(rootMessageId), newState, STATE_TTL_MS);

    const message = this.buildInboundMessage(parsed, threadId);
    await chat.processMessage(this, threadId, message, options);
  }

  /**
   * Build the normalized {@link Message} object from a parsed inbound
   * email. Detects `isMe` case-insensitively against {@link fromAddress},
   * preserves attachments verbatim (their `fetchData` is provider-supplied),
   * and constructs the mdast `formatted` field from the plain-text body.
   */
  protected buildInboundMessage(
    parsed: ParsedInboundEmail,
    threadId: string
  ): Message<EmailRawMessage> {
    const text = parsed.text ?? "";
    const author: Author = {
      userId: parsed.from.address,
      userName: parsed.from.address,
      fullName: parsed.from.name ?? parsed.from.address,
      isBot: false,
      isMe:
        parsed.from.address.toLowerCase() === this.fromAddress.toLowerCase(),
    };

    const formatted: FormattedContent = parseMarkdown(text);

    return new Message<EmailRawMessage>({
      id: stripAngleBrackets(parsed.messageId),
      threadId,
      text,
      formatted,
      author,
      raw: { direction: "inbound", email: parsed },
      attachments: (parsed.attachments ?? []).map((att) => ({
        type: inferAttachmentType(att.contentType),
        name: att.filename,
        mimeType: att.contentType,
        size: att.size,
        url: att.url,
        data: att.data,
        fetchData: att.fetchData,
      })),
      metadata: {
        dateSent: parsed.receivedAt,
        edited: false,
      },
    });
  }

  // ===========================================================================
  // Outbound
  // ===========================================================================

  /**
   * Compose and send a single email through the configured transport.
   *
   * The first call on a thread (when no prior outbound or inbound has been
   * stored) reuses the thread ID's reserved root as the outbound
   * `Message-ID` so {@link openDM} → first `post()` round-trips correctly
   * with replies. Subsequent calls generate a fresh `Message-ID`, set
   * `In-Reply-To` to the parent, and extend the `References` chain.
   *
   * @throws {ValidationError} if the adapter has no transport, or if the
   *   thread ID is missing a participant address (the latter happens only
   *   when callers construct a thread ID by hand instead of using
   *   {@link openDM}).
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<EmailRawMessage>> {
    if (!this.transport) {
      throw new ValidationError(
        "email",
        "No transport configured. Pass `provider:` or `transport:` to createEmailAdapter() to send messages."
      );
    }

    const decoded = decodeEmailThreadId(threadId);
    const recipient = decoded.participantAddress;
    if (!recipient) {
      throw new ValidationError(
        "email",
        `Cannot send to thread ${threadId}: recipient address is unknown. Use openDM() to start a new conversation.`
      );
    }

    const state = await this.loadThreadState(decoded.rootMessageId);
    const isFirstMessage = state.references.length === 0;
    const subject = isFirstMessage
      ? this.deriveInitialSubject(message)
      : replySubject(state.subject);

    // For outbound-initiated threads (openDM → first post), the threadId's
    // root was reserved upfront and we reuse it as this message's
    // Message-ID so the encoded threadId stays stable between bot and
    // recipient. For replies, generate a fresh Message-ID and chain it.
    const messageId = isFirstMessage
      ? decoded.rootMessageId
      : generateMessageId(this.messageIdDomain);
    const threadRootMessageId = decoded.rootMessageId;
    const parentMessageId = state.references.at(-1);

    const inReplyTo = parentMessageId;
    const references = parentMessageId
      ? buildReferencesChain(state.references.slice(0, -1), parentMessageId)
      : undefined;

    const { html, text } = this.renderBodies(message);

    const outbound: OutboundEmail = {
      from: { address: this.fromAddress, name: this.fromName },
      to: [recipient],
      replyTo: this.replyToAddress,
      subject,
      html,
      text,
      messageId,
      inReplyTo,
      references,
      threadRootMessageId,
    };

    const result: EmailSendResult = await this.transport
      .send(outbound)
      .catch((error: unknown) => {
        this.logger.error("Email transport send failed", {
          error,
          transport: this.transport?.name,
        });
        throw error;
      });

    // Update thread state to include this outbound message-id so the
    // next reply can extend the References chain correctly.
    await this.persistThreadState(threadRootMessageId, {
      references: [...state.references, messageId],
      subject,
      participantAddress: recipient,
    });

    // If this was the first message, the canonical thread ID changes
    // (root became this outbound message-id). The Chat instance still
    // sees the original threadId for routing purposes; that's fine
    // because openDM() callers receive the canonical ID.
    return {
      id: messageId,
      threadId,
      raw: { direction: "outbound", email: outbound, result },
    };
  }

  /**
   * Render an {@link AdapterPostableMessage} to a paired HTML body and
   * plain-text fallback. Cards go through {@link cardToHtml} +
   * {@link cardToPlainText}; markdown/raw/ast bodies share the
   * {@link markdownToHtml} pipeline.
   */
  protected renderBodies(message: AdapterPostableMessage): {
    html: string;
    text: string;
  } {
    const card = extractCard(message);
    if (card) {
      return {
        html: cardToHtml(card),
        text: cardToPlainText(card),
      };
    }
    if (typeof message === "string") {
      return {
        html: markdownToHtml(message),
        text: message,
      };
    }
    if ("raw" in message) {
      return {
        html: markdownToHtml(message.raw),
        text: message.raw,
      };
    }
    if ("markdown" in message) {
      return {
        html: markdownToHtml(message.markdown),
        text: message.markdown,
      };
    }
    // The remaining shape of AdapterPostableMessage is `PostableAst` —
    // `extractCard` already handled both PostableCard and CardElement, and
    // string / PostableRaw / PostableMarkdown were checked above. TypeScript
    // can't see through `extractCard`, so we narrow explicitly here.
    const md = stringifyMarkdown((message as PostableAst).ast);
    return {
      html: markdownToHtml(md),
      text: md,
    };
  }

  /**
   * Heuristically derive a Subject line for the first message in a
   * thread (replies always use `Re: <stored subject>` instead).
   *
   * Strategy, in order: first non-empty line of text/raw/markdown bodies,
   * `card.title` for `PostableCard` and direct `CardElement`, fallback to
   * `"Message from <userName>"`. Subjects longer than 80 characters are
   * truncated with an ellipsis.
   */
  protected deriveInitialSubject(message: AdapterPostableMessage): string {
    // First-line heuristic: take the first non-empty line of the text body
    // up to 80 chars, falling back to "Message from <userName>".
    let candidate: string | undefined;
    if (typeof message === "string") {
      candidate = firstLine(message);
    } else if ("raw" in message) {
      candidate = firstLine(message.raw);
    } else if ("markdown" in message) {
      candidate = firstLine(message.markdown);
    } else if ("card" in message && message.card.title) {
      candidate = message.card.title;
    } else if ("type" in message && message.type === "card" && message.title) {
      candidate = message.title;
    }
    if (!candidate) {
      return `Message from ${this.userName}`;
    }
    return candidate.length > 80 ? `${candidate.slice(0, 77)}...` : candidate;
  }

  // ===========================================================================
  // Streaming, edit, delete, reactions, typing — mostly unsupported
  // ===========================================================================

  /**
   * Stream a message by buffering all chunks and sending one email at the
   * end. Email has no live channel, so token-by-token rendering is
   * impossible; this matches the WhatsApp/Telegram adapters' approach.
   *
   * Non-text `StreamChunk` types (e.g. `task_update`, `plan_update`) are
   * silently dropped.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<EmailRawMessage>> {
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

  /** Always throws {@link NotImplementedError} — email messages are immutable once sent. */
  editMessage(): Promise<RawMessage<EmailRawMessage>> {
    return Promise.reject(
      new NotImplementedError(
        "Email messages are immutable. Send a new message instead.",
        "editMessage"
      )
    );
  }

  /** Always throws {@link NotImplementedError} — email has no delete API. */
  deleteMessage(): Promise<void> {
    return Promise.reject(
      new NotImplementedError(
        "Email messages cannot be deleted after sending.",
        "deleteMessage"
      )
    );
  }

  /** Always throws {@link NotImplementedError} — email has no reaction primitive. */
  addReaction(): Promise<void> {
    return Promise.reject(
      new NotImplementedError(
        "Email does not support reactions.",
        "addReaction"
      )
    );
  }

  /** Always throws {@link NotImplementedError} — email has no reaction primitive. */
  removeReaction(): Promise<void> {
    return Promise.reject(
      new NotImplementedError(
        "Email does not support reactions.",
        "removeReaction"
      )
    );
  }

  /** No-op — email has no typing indicator. Provided for `Adapter` contract parity. */
  async startTyping(): Promise<void> {
    // No-op: email has no typing indicator.
    await Promise.resolve();
  }

  // ===========================================================================
  // Thread / channel introspection
  // ===========================================================================

  /**
   * Returns an empty result — email has no server-side history API.
   *
   * If you need access to prior messages from a handler, opt in to the
   * SDK's `persistThreadHistory` mechanism on your {@link ChatConfig};
   * this adapter intentionally does not set `persistThreadHistory: true`
   * so that durability is an explicit user-side decision.
   */
  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<EmailRawMessage>> {
    await Promise.resolve();
    return { messages: [] };
  }

  /**
   * Resolve thread metadata from the persisted thread state. `channelName`
   * falls back to `"Email conversation"` if no subject has been observed
   * yet.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = decodeEmailThreadId(threadId);
    const state = await this.loadThreadState(decoded.rootMessageId);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      channelName: state.subject ?? "Email conversation",
      isDM: true,
      metadata: {
        rootMessageId: decoded.rootMessageId,
        participantAddress: decoded.participantAddress,
        subject: state.subject,
      },
    };
  }

  /** Encode `{ rootMessageId, participantAddress }` into the canonical `email:<root>:<addr>` thread ID. */
  encodeThreadId(data: EmailThreadId): string {
    return encodeEmailThreadId(data);
  }

  /**
   * Decode an `email:<root>:<addr>` thread ID.
   *
   * @throws {ValidationError} on prefix mismatch, empty segments, or
   *   base64url segments that decode to an empty string.
   */
  decodeThreadId(threadId: string): EmailThreadId {
    return decodeEmailThreadId(threadId);
  }

  /**
   * Email is inherently 1:1 — there's no distinct channel container,
   * so the thread ID doubles as the channel ID.
   */
  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  /** Always `true` — every email thread is a direct conversation. */
  isDM(_threadId: string): boolean {
    return true;
  }

  /**
   * Reconstruct a {@link Message} from a serialized {@link EmailRawMessage}.
   *
   * Used by the SDK during message rehydration for queue/debounce
   * strategies. The discriminator on `raw.direction` selects whether to
   * build an inbound or outbound message; `isMe` / `isBot` are wired
   * accordingly.
   */
  parseMessage(raw: EmailRawMessage): Message<EmailRawMessage> {
    if (raw.direction === "outbound") {
      const out = raw.email;
      const recipient = out.to[0] ?? "";
      const threadId = encodeEmailThreadId({
        rootMessageId: out.threadRootMessageId,
        participantAddress: recipient,
      });
      const author: Author = {
        userId: this.fromAddress,
        userName: this.userName,
        fullName: this.fromName ?? this.userName,
        isBot: true,
        isMe: true,
      };
      return new Message<EmailRawMessage>({
        id: out.messageId,
        threadId,
        text: out.text,
        formatted: parseMarkdown(out.text),
        author,
        raw,
        attachments: [],
        metadata: { dateSent: new Date(), edited: false },
      });
    }
    const inbound = raw.email;
    const threadId = encodeEmailThreadId({
      rootMessageId:
        findThreadRoot({
          references: inbound.references?.map(stripAngleBrackets),
          inReplyTo: inbound.inReplyTo
            ? stripAngleBrackets(inbound.inReplyTo)
            : undefined,
        }) ?? stripAngleBrackets(inbound.messageId),
      participantAddress: inbound.from.address,
    });
    return this.buildInboundMessage(inbound, threadId);
  }

  /**
   * Render a chat-sdk {@link FormattedContent} (mdast) back to markdown.
   * The canonical outbound HTML rendering lives in {@link renderBodies};
   * this method satisfies the {@link Adapter} contract for downstream
   * consumers like transcripts.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Open a 1:1 conversation with an email address. The returned thread ID
   * uses a fresh root Message-ID; the first call to `postMessage` replaces
   * that placeholder root with the actual outbound Message-ID via the
   * stored thread state, but the encoded thread ID stays stable for the
   * caller.
   */
  async openDM(emailAddress: string): Promise<string> {
    if (!emailAddress.includes("@")) {
      throw new ValidationError(
        "email",
        `Invalid email address: ${emailAddress}`
      );
    }
    const rootMessageId = generateMessageId(this.messageIdDomain);
    // Pre-stash empty thread state under the new root so that the first
    // postMessage call uses the placeholder root as the canonical ID.
    await this.persistThreadState(rootMessageId, {
      references: [],
      participantAddress: emailAddress,
    });
    return encodeEmailThreadId({
      rootMessageId,
      participantAddress: emailAddress,
    });
  }

  // ===========================================================================
  // State helpers
  // ===========================================================================

  /** State-adapter key namespace for per-thread metadata. */
  protected threadStateKey(rootMessageId: string): string {
    return `email:thread:${rootMessageId}`;
  }

  /**
   * Read the per-thread metadata blob. Returns an empty references list
   * when the thread has no prior state (new conversation or expired TTL).
   */
  protected async loadThreadState(
    rootMessageId: string
  ): Promise<EmailThreadState> {
    if (!this.chat) {
      return { references: [] };
    }
    const stored = await this.chat
      .getState()
      .get<EmailThreadState>(this.threadStateKey(rootMessageId));
    return stored ?? { references: [] };
  }

  /**
   * Persist per-thread metadata (references chain, last subject,
   * participant address). TTL is 30 days, refreshed on every write.
   */
  protected async persistThreadState(
    rootMessageId: string,
    state: EmailThreadState
  ): Promise<void> {
    if (!this.chat) {
      return;
    }
    await this.chat
      .getState()
      .set(this.threadStateKey(rootMessageId), state, STATE_TTL_MS);
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Map a MIME type to the chat-sdk {@link Attachment} kind. Unknown or
 * missing content types default to `"file"`.
 */
function inferAttachmentType(
  contentType: string | undefined
): "image" | "file" | "video" | "audio" {
  if (!contentType) {
    return "file";
  }
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

const NEWLINE_PATTERN = /\r?\n/;
const HEADING_HASH_PREFIX = /^#+\s*/;

/**
 * Return the first non-empty trimmed line of a text body, with any
 * leading markdown heading hashes stripped. Returns `undefined` if every
 * line is blank.
 */
function firstLine(text: string): string | undefined {
  for (const line of text.split(NEWLINE_PATTERN)) {
    const trimmed = line.trim().replace(HEADING_HASH_PREFIX, "");
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}
