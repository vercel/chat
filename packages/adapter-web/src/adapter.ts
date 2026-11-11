/**
 * Web adapter for chat-sdk.
 *
 * Lets a chat-sdk bot serve a browser UI alongside Slack/Teams/Discord. The
 * browser POSTs the conversation, the user handler runs on the server, and
 * its output streams back in the same response body using the configured
 * protocol (AI SDK UI message stream or AG-UI).
 */

import { ValidationError } from "@chat-adapter/shared";
import {
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  ConsoleLogger,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type Logger,
  Message,
  NotImplementedError,
  type RawMessage,
  type StreamChunk,
  type StreamOptions,
  type ThreadInfo,
  type UserInfo,
} from "chat";
import { requireWebRequestContext, webRequestContext } from "./als";
import { WebFormatConverter } from "./format-converter";
import {
  createSseResponse,
  generateId,
  type WebProtocol,
  webProtocols,
} from "./protocol";
import type { WebAdapterConfig, WebMessage, WebUser } from "./types";

/** Decoded thread id components for the Web adapter. */
export interface WebThreadIdData {
  conversationId: string;
  userId: string;
}

const ADAPTER_NAME = "web";

/** Default thread id derivation: `web:{userId}:{conversationId}`. */
const defaultThreadIdFor = (args: {
  user: WebUser;
  conversationId: string;
}): string => `${ADAPTER_NAME}:${args.user.id}:${args.conversationId}`;

export class WebAdapter implements Adapter<WebThreadIdData, WebMessage> {
  readonly name = ADAPTER_NAME;
  readonly userName: string;
  readonly persistMessageHistory: boolean;
  readonly lockScope = "thread" as const;

  protected chat: ChatInstance | null = null;
  protected readonly logger: Logger;
  protected readonly formatConverter = new WebFormatConverter();
  protected readonly protocol: WebProtocol;
  protected readonly resolveUser: WebAdapterConfig["getUser"];
  protected readonly threadIdFor: NonNullable<WebAdapterConfig["threadIdFor"]>;

  constructor(opts: WebAdapterConfig) {
    if (!opts.userName) {
      throw new ValidationError(ADAPTER_NAME, "userName is required");
    }
    if (typeof opts.getUser !== "function") {
      throw new ValidationError(
        ADAPTER_NAME,
        "getUser is required — supply a function that resolves the user from the inbound Request"
      );
    }
    this.userName = opts.userName;
    const protocolName = opts.protocol ?? "ai-sdk";
    if (!Object.hasOwn(webProtocols, protocolName)) {
      throw new ValidationError(
        ADAPTER_NAME,
        `Unknown protocol "${protocolName}". Use "ai-sdk" or "ag-ui".`
      );
    }
    this.protocol = webProtocols[protocolName];
    this.resolveUser = opts.getUser;
    this.threadIdFor = opts.threadIdFor ?? defaultThreadIdFor;
    // Default true: with no platform-side message API, the only way for
    // chat-sdk handlers to see prior turns (via thread/channel.messages) is
    // through the configured state adapter. The request body's `messages[]`
    // is not an alternative source — it is client-controlled and ignored
    // beyond the latest user message — so opting out leaves handlers with
    // only the current message.
    this.persistMessageHistory = opts.persistMessageHistory ?? true;
    this.logger = opts.logger ?? new ConsoleLogger("info", "chat-adapter-web");
  }

  initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    return Promise.resolve();
  }

  async handleWebhook(request: Request): Promise<Response> {
    if (!this.chat) {
      return jsonError(500, "Web adapter not initialized");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    let user: WebUser | null;
    try {
      user = await this.resolveUser(request);
    } catch (err) {
      this.logger.error("getUser threw", { error: err });
      return jsonError(401, "Unauthorized");
    }
    if (!user) {
      return jsonError(401, "Unauthorized");
    }
    if (user.id.includes(":")) {
      // Thread ids embed the user id between `:` delimiters
      // (`web:{userId}:{conversationId}`); a colon in the userId would
      // corrupt the round-trip through decodeThreadId.
      this.logger.error("getUser returned id with reserved ':' character", {
        userId: user.id,
      });
      return jsonError(400, "Invalid user id");
    }

    const parsed = this.protocol.parseRequest(body);
    if ("error" in parsed) {
      return jsonError(400, parsed.error);
    }

    const conversationId = parsed.conversationId ?? generateId();
    if (conversationId.includes(":")) {
      return jsonError(400, "Invalid conversation id");
    }
    const threadId = this.threadIdFor({ user, conversationId });

    // The client-supplied messages array is untrusted, so the protocol only
    // returns the latest user message, with tool parts stripped. Prior turns
    // come from the state adapter (persistMessageHistory), never from the
    // request body.
    const userMessage = parsed.message;
    if (userMessage.parts.length === 0) {
      return jsonError(400, "No usable content in last user message");
    }

    const message = this.buildMessageFromUI(userMessage, threadId, user);

    const chat = this.chat;
    const run = { conversationId, runId: parsed.runId ?? generateId() };
    return createSseResponse(this.protocol, async (send) => {
      for (const payload of this.protocol.begin(run)) {
        send(payload);
      }
      let errorText: string | undefined;
      try {
        await webRequestContext.run(
          {
            write: (event) => send(this.protocol.encode(event)),
            signal: request.signal,
            userId: user.id,
            conversationId,
          },
          // Web requests are never redelivered, so a repeated message id
          // is a deliberate regenerate or reload and must reach the handler.
          // The tradeoff is that history keeps the earlier reply and stores
          // the user message twice.
          () =>
            chat.processMessage(this, threadId, message, {
              deduplicate: false,
            })
        );
      } catch (error) {
        // chat.processMessage already logs handler errors at ERROR level.
        // Just turn the error into a string for the client.
        errorText = error instanceof Error ? error.message : "Internal error";
      }
      for (const payload of this.protocol.end(run, errorText)) {
        send(payload);
      }
    });
  }

  parseMessage(raw: WebMessage): Message<WebMessage> {
    const text = extractText(raw);
    // The hot path uses buildMessageFromUI (which has WebUser context) and
    // does not call this method. Round-trip rehydration paths land here
    // without a WebUser, so for assistant messages we identify the bot by
    // userName, and for user messages we leave userId as "unknown".
    const isAssistant = raw.role !== "user";
    const author = isAssistant
      ? {
          userId: this.userName,
          userName: this.userName,
          fullName: this.userName,
          isBot: true,
          isMe: true,
        }
      : {
          userId: "unknown",
          userName: "unknown",
          fullName: "unknown",
          isBot: false,
          isMe: false,
        };
    return new Message<WebMessage>({
      id: raw.id,
      threadId: "",
      text,
      formatted: this.formatConverter.parseIncoming(text).formatted,
      raw,
      author,
      metadata: { dateSent: new Date(), edited: false },
      attachments: [],
    });
  }

  encodeThreadId(data: WebThreadIdData): string {
    return `${ADAPTER_NAME}:${data.userId}:${data.conversationId}`;
  }

  decodeThreadId(threadId: string): WebThreadIdData {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== ADAPTER_NAME) {
      throw new ValidationError(
        ADAPTER_NAME,
        `Invalid web thread id: ${threadId}`
      );
    }
    const [, userId, ...rest] = parts;
    return { userId, conversationId: rest.join(":") };
  }

  channelIdFromThreadId(threadId: string): string {
    // Web has no separate "channel" concept — each useChat conversation is
    // its own thread. Returning threadId keeps channel.messages and
    // thread.messages in sync and prevents cross-conversation bleed when
    // persistMessageHistory is enabled.
    return threadId;
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WebMessage>> {
    const ctx = requireWebRequestContext();
    const text = adapterPostableToText(message, this.formatConverter);
    const id = generateId();
    // Skip empty messages (e.g., a CardElement with no fallbackText) so
    // the client doesn't render a blank assistant bubble.
    if (!text) {
      return {
        id,
        threadId,
        raw: assistantMessageFromText(id, ""),
      };
    }
    ctx.write({ type: "text-start", id });
    ctx.write({ type: "text-delta", id, delta: text });
    ctx.write({ type: "text-end", id });
    return {
      id,
      threadId,
      raw: assistantMessageFromText(id, text),
    };
  }

  /**
   * Native streaming path. Pumps text chunks straight onto the per-request SSE
   * response body — no edit loop, no rate limiting concerns. Honors the
   * inbound request's abort signal so the client's `stop()` short-circuits
   * the generator on the server side.
   */
  async stream(
    threadId: string,
    iterable: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<WebMessage>> {
    const ctx = requireWebRequestContext();
    const id = generateId();
    let fullText = "";
    ctx.write({ type: "text-start", id });
    try {
      for await (const chunk of iterable) {
        if (ctx.signal.aborted) {
          break;
        }
        const text = streamChunkToText(chunk);
        if (text) {
          fullText += text;
          ctx.write({ type: "text-delta", id, delta: text });
        }
      }
    } finally {
      ctx.write({ type: "text-end", id });
    }
    return {
      id,
      threadId,
      raw: assistantMessageFromText(id, fullText),
    };
  }

  // ---------------------------------------------------------------------------
  // Required-by-interface methods that have no native concept on web (v1 stubs)
  // ---------------------------------------------------------------------------

  editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<WebMessage>> {
    throw new NotImplementedError(
      "WebAdapter.editMessage is not supported in v1 — every assistant turn is a fresh streamed response."
    );
  }

  deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "WebAdapter.deleteMessage is not supported in v1."
    );
  }

  addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "WebAdapter.addReaction is not supported in v1."
    );
  }

  removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "WebAdapter.removeReaction is not supported in v1."
    );
  }

  startTyping(_threadId: string, _status?: string): Promise<void> {
    // Clients derive a "streaming" status from the SSE response itself, so an
    // explicit typing indicator is unnecessary on web.
    return Promise.resolve();
  }

  /**
   * Always resolves to an empty list. Web has no platform-side history API;
   * when `persistMessageHistory: true` (the default) chat-sdk's own
   * `MessageHistoryCache` backfills `thread.messages` / `channel.messages`
   * from state after this method returns.
   */
  fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<WebMessage>> {
    return Promise.resolve({ messages: [] });
  }

  fetchThread(threadId: string): Promise<ThreadInfo> {
    return Promise.resolve({
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      isDM: true,
      metadata: {},
    });
  }

  getUser(_userId: string): Promise<UserInfo | null> {
    // The Web adapter doesn't have a user directory — host apps can supply
    // their own via WebAdapterConfig.getUser.
    return Promise.resolve(null);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  protected buildMessageFromUI(
    uiMessage: WebMessage,
    threadId: string,
    user: WebUser
  ): Message<WebMessage> {
    const text = extractText(uiMessage);
    return new Message<WebMessage>({
      id: uiMessage.id,
      threadId,
      text,
      formatted: this.formatConverter.parseIncoming(text).formatted,
      raw: uiMessage,
      author: {
        userId: user.id,
        userName: user.name ?? user.id,
        fullName: user.name ?? user.id,
        isBot: false,
        isMe: false,
      },
      metadata: { dateSent: new Date(), edited: false },
      attachments: [],
    });
  }
}

// =============================================================================
// Helpers (module-private)
// =============================================================================

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractText(message: WebMessage): string {
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.join("\n");
}

function streamChunkToText(chunk: string | StreamChunk): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk.type === "markdown_text") {
    return chunk.text;
  }
  // task_update / plan_update — no native v1 representation on the wire.
  // Future: emit as data-* parts. For now ignored so the stream stays clean.
  return "";
}

function adapterPostableToText(
  message: AdapterPostableMessage,
  formatConverter: WebFormatConverter
): string {
  if (typeof message === "string") {
    return message;
  }
  if ("raw" in message && typeof message.raw === "string") {
    return message.raw;
  }
  if ("markdown" in message && typeof message.markdown === "string") {
    return message.markdown;
  }
  if ("ast" in message) {
    return formatConverter.fromAst(message.ast);
  }
  if ("card" in message) {
    return message.fallbackText ?? "";
  }
  // CardElement direct — degrade to empty (cards are out-of-scope for v1)
  return "";
}

function assistantMessageFromText(id: string, text: string): WebMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}
