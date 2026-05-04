/**
 * Web adapter for chat-sdk.
 *
 * Speaks the AI SDK UI message stream protocol so a chat-sdk bot can serve
 * a browser UI alongside Slack/Teams/Discord. The browser POSTs the
 * conversation, the user handler runs on the server, and its output streams
 * back in the same response body.
 */

import { ValidationError } from "@chat-adapter/shared";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isTextUIPart,
  type UIMessage,
} from "ai";
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
  parseMarkdown,
  type RawMessage,
  type StreamChunk,
  type StreamOptions,
  type ThreadInfo,
  type UserInfo,
} from "chat";
import { requireWebRequestContext, webRequestContext } from "./als";
import { WebFormatConverter } from "./format-converter";
import type { WebAdapterOptions, WebUser } from "./types";

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

interface WebRequestBody {
  /** Optional useChat-supplied conversation id. Generated if absent. */
  id?: string;
  /** Latest UIMessage[] history sent by useChat. */
  messages: UIMessage[];
}

export class WebAdapter implements Adapter<WebThreadIdData, UIMessage> {
  readonly name = ADAPTER_NAME;
  readonly userName: string;
  readonly persistMessageHistory: boolean;
  readonly lockScope = "thread" as const;

  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new WebFormatConverter();
  private readonly resolveUser: WebAdapterOptions["getUser"];
  private readonly threadIdFor: NonNullable<WebAdapterOptions["threadIdFor"]>;

  constructor(opts: WebAdapterOptions) {
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
    this.resolveUser = opts.getUser;
    this.threadIdFor = opts.threadIdFor ?? defaultThreadIdFor;
    // Default true: with no platform-side message API, the only way for
    // chat-sdk handlers to see prior turns (via thread/channel.messages) is
    // through the configured state adapter. Opt out only if your handler
    // re-derives history from the request body's `messages[]` itself.
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

    let body: WebRequestBody;
    try {
      body = (await request.json()) as WebRequestBody;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonError(400, "Request body must include a messages array");
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

    const conversationId = body.id ?? generateId();
    const threadId = this.threadIdFor({ user, conversationId });

    const lastUserMessage = findLastUserMessage(body.messages);
    if (!lastUserMessage) {
      return jsonError(400, "No user message found in messages array");
    }

    const message = this.buildMessageFromUI(lastUserMessage, threadId, user);

    const chat = this.chat;
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: body.messages,
      execute: async ({ writer }) => {
        const assistantMessageId = generateId();
        writer.write({ type: "start", messageId: assistantMessageId });
        writer.write({ type: "start-step" });
        try {
          await webRequestContext.run(
            {
              writer,
              signal: request.signal,
              userId: user.id,
              conversationId,
            },
            () => chat.processMessage(this, threadId, message)
          );
        } finally {
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish" });
        }
      },
      onError: (error) =>
        // chat.processMessage already logs handler errors at ERROR level.
        // Just turn the error into a string for the SSE error chunk.
        error instanceof Error ? error.message : "Internal error",
    });

    return createUIMessageStreamResponse({ stream });
  }

  parseMessage(raw: UIMessage): Message<UIMessage> {
    const text = extractTextFromUIMessage(raw);
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
    return new Message<UIMessage>({
      id: raw.id,
      threadId: "",
      text,
      formatted: parseMarkdown(text),
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
  ): Promise<RawMessage<UIMessage>> {
    const ctx = requireWebRequestContext();
    const text = adapterPostableToText(message, this.formatConverter);
    const id = generateId();
    // Skip empty messages (e.g., a CardElement with no fallbackText) so
    // useChat doesn't render a blank assistant bubble.
    if (!text) {
      return {
        id,
        threadId,
        raw: assistantUIMessageFromText(id, ""),
      };
    }
    ctx.writer.write({ type: "text-start", id });
    ctx.writer.write({ type: "text-delta", id, delta: text });
    ctx.writer.write({ type: "text-end", id });
    return {
      id,
      threadId,
      raw: assistantUIMessageFromText(id, text),
    };
  }

  /**
   * Native streaming path. Pumps text chunks straight onto the per-request SSE
   * response body — no edit loop, no rate limiting concerns. Honors the
   * inbound request's abort signal so `useChat`'s `stop()` short-circuits the
   * generator on the server side.
   */
  async stream(
    threadId: string,
    iterable: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<UIMessage>> {
    const ctx = requireWebRequestContext();
    const id = generateId();
    let fullText = "";
    ctx.writer.write({ type: "text-start", id });
    try {
      for await (const chunk of iterable) {
        if (ctx.signal.aborted) {
          break;
        }
        const text = streamChunkToText(chunk);
        if (text) {
          fullText += text;
          ctx.writer.write({ type: "text-delta", id, delta: text });
        }
      }
    } finally {
      ctx.writer.write({ type: "text-end", id });
    }
    return {
      id,
      threadId,
      raw: assistantUIMessageFromText(id, fullText),
    };
  }

  // ---------------------------------------------------------------------------
  // Required-by-interface methods that have no native concept on web (v1 stubs)
  // ---------------------------------------------------------------------------

  editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<UIMessage>> {
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
    // useChat derives a "streaming" status from the SSE response itself, so an
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
  ): Promise<FetchResult<UIMessage>> {
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
    // their own via WebAdapterOptions.getUser.
    return Promise.resolve(null);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildMessageFromUI(
    uiMessage: UIMessage,
    threadId: string,
    user: WebUser
  ): Message<UIMessage> {
    const text = extractTextFromUIMessage(uiMessage);
    return new Message<UIMessage>({
      id: uiMessage.id,
      threadId,
      text,
      formatted: parseMarkdown(text),
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

function findLastUserMessage(messages: UIMessage[]): UIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      return m;
    }
  }
  return null;
}

function extractTextFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((p) => p.text)
    .join("\n");
}

function streamChunkToText(chunk: string | StreamChunk): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk.type === "markdown_text") {
    return chunk.text;
  }
  // task_update / plan_update — no native v1 representation in UIMessage.
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

function assistantUIMessageFromText(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

function generateId(): string {
  // crypto.randomUUID is available in Node 19+ and modern browsers.
  // Fallback ensures we don't hard-fail if it's missing.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createWebAdapter(opts: WebAdapterOptions): WebAdapter {
  return new WebAdapter(opts);
}
