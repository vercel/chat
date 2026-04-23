import { AuthenticationError, ValidationError } from "@chat-adapter/shared";
import type {
  LarkChannel,
  LarkChannelOptions,
  CardActionEvent as LarkCardActionEvent,
  ReactionEvent as LarkReactionEvent,
  NormalizedMessage,
  RawMessageEvent,
} from "@larksuiteoapi/node-sdk";
import { createLarkChannel, normalize } from "@larksuiteoapi/node-sdk";

// SDK defines `RawMention` internally but doesn't export it — inline the
// shape so we can type ApiMessageItem.mentions.
interface RawMention {
  id: { open_id?: string; user_id?: string; union_id?: string };
  key: string;
  name?: string;
  tenant_key?: string;
}

import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message, parseMarkdown, stringifyMarkdown } from "chat";
import { fromLarkEmojiType, toLarkEmojiType } from "./emoji";
import type { LarkThreadId } from "./thread-id";
import {
  channelIdFromThreadId,
  decodeThreadId,
  deriveRootId,
  encodeThreadId,
} from "./thread-id";

/**
 * Register a new Lark self-build app via the scan-to-create flow.
 *
 * The SDK generates a one-time URL that the user scans with the Lark mobile
 * app. After the user confirms the prompt, Lark creates the app in their
 * tenant with the permissions and event subscriptions this adapter needs,
 * then returns its `client_id` / `client_secret` (use as `appId` /
 * `appSecret`).
 *
 * This is a convenience re-export of the SDK's own `registerApp`, named to
 * match the `createLarkAdapter` prefix convention.
 *
 * @example
 * ```typescript
 * import { registerLarkApp, createLarkAdapter } from "@chat-adapter/lark";
 * import qrcode from "qrcode-terminal";
 *
 * const { client_id, client_secret } = await registerLarkApp({
 *   onQRCodeReady: ({ url }) => qrcode.generate(url, { small: true }),
 *   onStatusChange: (s) => console.log("status:", s.status),
 * });
 *
 * const adapter = createLarkAdapter({
 *   appId: client_id,
 *   appSecret: client_secret,
 * });
 * ```
 */
export { registerApp as registerLarkApp } from "@larksuiteoapi/node-sdk";
export {
  fromLarkEmojiType,
  isValidLarkEmoji,
  toLarkEmojiType,
  VALID_LARK_EMOJI_TYPES,
} from "./emoji";
export type { LarkThreadId } from "./thread-id";
export {
  channelIdFromThreadId,
  decodeThreadId,
  deriveRootId,
  encodeThreadId,
} from "./thread-id";

// SDK declares these shapes internally but doesn't export them. Inline so
// callers can type their `onQRCodeReady` / result handlers.
export interface RegisterLarkAppOptions {
  domain?: string;
  larkDomain?: string;
  onQRCodeReady: (info: { url: string; expireIn: number }) => void;
  onStatusChange?: (info: {
    status: "polling" | "slow_down" | "domain_switched";
    interval?: number;
  }) => void;
  signal?: AbortSignal;
  source?: string;
}

export interface RegisterLarkAppResult {
  client_id: string;
  client_secret: string;
  user_info?: {
    open_id?: string;
    tenant_brand?: "feishu" | "lark";
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LarkAdapterConfig {
  /** Lark app ID. Defaults to LARK_APP_ID env var. */
  appId?: string;
  /** Lark app secret. Defaults to LARK_APP_SECRET env var. */
  appSecret?: string;
  /**
   * @internal — override channel factory for testing. Not part of the public API.
   */
  channelFactory?: (opts: LarkChannelOptions) => LarkChannel;
  /** Logger instance. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Bot display name. Defaults to LARK_BOT_USERNAME env var or "bot". */
  userName?: string;
}

// ---------------------------------------------------------------------------
// Minimal shapes for rawClient responses we consume. The SDK's generated types
// are intentionally avoided here — the surface we touch is small and stable,
// and typing against unknown rawClient generics adds more friction than it
// removes.
// ---------------------------------------------------------------------------

/**
 * Shape of a single message returned by `im.v1.messages.{list,get}`.
 * The SDK's public `ApiMessageItem` type has a minimal subset (used for
 * merge_forward recursion); the real API carries more — we widen it here.
 */
interface ApiMessageItem {
  body?: { content?: string };
  chat_id?: string;
  create_time?: string;
  mentions?: RawMention[];
  message_id?: string;
  msg_type?: string;
  parent_id?: string;
  root_id?: string;
  sender?: {
    id?: string;
    id_type?: string;
    sender_type?: string;
    tenant_key?: string;
  };
  thread_id?: string;
  update_time?: string;
}

interface ApiMessageListResponse {
  data?: {
    has_more?: boolean;
    page_token?: string;
    items?: ApiMessageItem[];
  };
}

interface ApiMessageGetResponse {
  data?: { items?: ApiMessageItem[] };
}

// ---------------------------------------------------------------------------
// LarkAdapter
// ---------------------------------------------------------------------------

/**
 * Lark (Feishu) adapter for the chat SDK.
 *
 * Wraps `LarkChannel` from `@larksuiteoapi/node-sdk`. The channel handles
 * inbound normalization (23 message types → NormalizedMessage), outbound
 * markdown-to-post conversion, chunking, media upload, and cardkit
 * typewriter streaming. This adapter is a thin shape-translator between
 * the channel and the chat SDK's `Adapter` contract.
 *
 * Transport: WebSocket only (no webhook support).
 * Safety: Delegated to chat SDK + StateAdapter (channel safety disabled).
 */
export class LarkAdapter implements Adapter<LarkThreadId, NormalizedMessage> {
  readonly name = "lark";
  readonly userName: string;
  readonly persistMessageHistory = false;

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly logger: Logger;
  private readonly channelFactory?: (
    opts: LarkChannelOptions
  ) => LarkChannel;
  private chat: ChatInstance | null = null;
  private channel: LarkChannel | null = null;
  /**
   * Cache of chat IDs known to be p2p (DM) conversations.
   *
   * Lark's chat_id format is `oc_*` for both group chats and p2p chats —
   * the prefix alone cannot distinguish them. We populate this set as
   * p2p messages arrive so `isDM(threadId)` can answer synchronously.
   *
   * openDM placeholders use `ou_{open_id}` as chatId and are detected by
   * prefix alone, so they don't need to be cached here.
   */
  private readonly p2pChats = new Set<string>();

  constructor(config: LarkAdapterConfig = {}) {
    const appId = config.appId ?? process.env.LARK_APP_ID;
    const appSecret = config.appSecret ?? process.env.LARK_APP_SECRET;

    if (!appId) {
      throw new AuthenticationError(
        "lark",
        "appId is required (set LARK_APP_ID env var or pass config.appId)"
      );
    }
    if (!appSecret) {
      throw new AuthenticationError(
        "lark",
        "appSecret is required (set LARK_APP_SECRET env var or pass config.appSecret)"
      );
    }

    this.appId = appId;
    this.appSecret = appSecret;
    this.userName = config.userName ?? process.env.LARK_BOT_USERNAME ?? "bot";
    this.logger = config.logger ?? new ConsoleLogger("info", "lark");
    this.channelFactory = config.channelFactory;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    const channelLogger = chat.getLogger("lark");
    const factory = this.channelFactory ?? createLarkChannel;
    // Chat-SDK Logger and Lark-SDK Logger differ by one method (`trace`).
    // Wrap to fit Lark's shape — trace degrades to debug.
    const wrappedLogger = {
      debug: (...args: unknown[]) =>
        channelLogger.debug(String(args[0] ?? ""), ...args.slice(1)),
      info: (...args: unknown[]) =>
        channelLogger.info(String(args[0] ?? ""), ...args.slice(1)),
      warn: (...args: unknown[]) =>
        channelLogger.warn(String(args[0] ?? ""), ...args.slice(1)),
      error: (...args: unknown[]) =>
        channelLogger.error(String(args[0] ?? ""), ...args.slice(1)),
      trace: (...args: unknown[]) =>
        channelLogger.debug(String(args[0] ?? ""), ...args.slice(1)),
    };
    const channel = factory({
      appId: this.appId,
      appSecret: this.appSecret,
      transport: "websocket",
      // Tagged in the User-Agent as `source/vercel-chat` so Lark can
      // distinguish traffic coming from this adapter.
      source: "vercel-chat",
      logger: wrappedLogger,
      safety: {
        // Disable SDK safety features — Chat SDK + StateAdapter handle
        // stale/dedup/locking/batching. We want every normalized message to
        // pass through to our handler untouched.
        //
        // Note: the SDK treats staleMessageWindowMs as a window, not a
        // flag. Setting it to 0 means "anything older than 0ms is stale" —
        // which drops every real message. MAX_SAFE_INTEGER effectively
        // disables the check.
        staleMessageWindowMs: Number.MAX_SAFE_INTEGER,
        chatQueue: { enabled: false },
        batch: {
          text: { delayMs: 0 },
          media: { delayMs: 0 },
        },
      },
    });
    this.channel = channel;

    channel.on("message", async (nm: NormalizedMessage) => {
      if (nm.chatType === "p2p") {
        this.p2pChats.add(nm.chatId);
      }
      const threadId = this.threadIdOf(nm);
      chat.processMessage(this, threadId, () =>
        Promise.resolve(this.parseMessage(nm))
      );
    });

    channel.on("cardAction", async (evt: LarkCardActionEvent) => {
      await this.handleCardAction(evt);
    });

    channel.on("reaction", async (evt: LarkReactionEvent) => {
      await this.handleReaction(evt);
    });

    await channel.connect();
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      await this.channel.disconnect();
    }
  }

  // -------------------------------------------------------------------------
  // Thread ID
  // -------------------------------------------------------------------------

  encodeThreadId(data: LarkThreadId): string {
    return encodeThreadId(data);
  }

  decodeThreadId(threadId: string): LarkThreadId {
    return decodeThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return channelIdFromThreadId(threadId);
  }

  private threadIdOf(nm: NormalizedMessage): string {
    return encodeThreadId({
      chatId: nm.chatId,
      rootId: deriveRootId({
        threadId: nm.threadId,
        rootId: nm.rootId,
        messageId: nm.messageId,
      }),
    });
  }

  // -------------------------------------------------------------------------
  // Webhook — WS-only adapter returns 501
  // -------------------------------------------------------------------------

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    return new Response(
      JSON.stringify({
        error: "lark adapter is websocket-only; webhook not supported",
      }),
      {
        status: 501,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // -------------------------------------------------------------------------
  // Parsing / rendering
  // -------------------------------------------------------------------------

  parseMessage(nm: NormalizedMessage): Message<NormalizedMessage> {
    const threadId = this.threadIdOf(nm);
    const content = nm.content ?? "";
    const botOpenId = this.channel?.botIdentity?.openId;
    const isMe = nm.senderId === botOpenId;
    const author: Author = {
      userId: nm.senderId,
      userName: nm.senderName ?? nm.senderId,
      fullName: nm.senderName ?? nm.senderId,
      isBot: isMe ? true : "unknown",
      isMe,
    };
    return new Message<NormalizedMessage>({
      id: nm.messageId,
      threadId,
      text: content,
      formatted: parseMarkdown(content),
      raw: nm,
      author,
      // Lark strips the @mention token from normalized content (SDK
      // default `stripBotMentions: true`), so chat-SDK's text-scanning
      // mention detector would miss it. Trust the structured field that
      // the SDK computed during normalization.
      isMention: nm.mentionedBot,
      metadata: {
        dateSent: new Date(nm.createTime),
        edited: false,
      },
      attachments: [],
      links: [],
    });
  }

  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content);
  }

  // -------------------------------------------------------------------------
  // Inbound handlers
  // -------------------------------------------------------------------------

  private async handleCardAction(evt: LarkCardActionEvent): Promise<void> {
    if (!this.chat) {
      return;
    }
    const rootId = await this.fetchRootIdFor(evt.messageId);
    const threadId = encodeThreadId({ chatId: evt.chatId, rootId });
    const actionId = evt.action.name ?? evt.action.tag;
    const value =
      typeof evt.action.value === "string"
        ? evt.action.value
        : JSON.stringify(evt.action.value);
    const user: Author = {
      userId: evt.operator.openId,
      userName: evt.operator.name ?? evt.operator.openId,
      fullName: evt.operator.name ?? evt.operator.openId,
      isBot: false,
      isMe: false,
    };
    await this.chat.processAction(
      {
        adapter: this,
        actionId,
        messageId: evt.messageId,
        threadId,
        user,
        value,
        raw: evt,
      },
      undefined
    );
  }

  private async handleReaction(evt: LarkReactionEvent): Promise<void> {
    if (!this.chat) {
      return;
    }
    // Lark's ReactionEvent does not carry chat_id; we fetch the reacted
    // message to recover both chat_id and root_id in one API call.
    const { chatId, rootId } = await this.fetchChatAndRootFor(evt.messageId);
    const threadId = chatId ? encodeThreadId({ chatId, rootId }) : "";
    const emoji = fromLarkEmojiType(evt.emojiType);
    const user: Author = {
      userId: evt.operator.openId,
      userName: evt.operator.openId,
      fullName: evt.operator.openId,
      isBot: false,
      isMe: false,
    };
    this.chat.processReaction(
      {
        adapter: this,
        added: evt.action === "added",
        emoji,
        messageId: evt.messageId,
        threadId,
        rawEmoji: evt.emojiType,
        user,
        raw: evt,
      },
      undefined
    );
  }

  /**
   * Fetch the root_id of a message so we can build a stable threadId for
   * cardAction / reaction events that don't carry root_id directly.
   */
  private async fetchRootIdFor(messageId: string): Promise<string> {
    const { rootId } = await this.fetchChatAndRootFor(messageId);
    return rootId;
  }

  /**
   * Fetch chat_id and root_id of a message via `im.v1.messages.get`. Used
   * for cardAction and reaction events, which otherwise lack enough context
   * to build a complete threadId.
   */
  private async fetchChatAndRootFor(
    messageId: string
  ): Promise<{ chatId: string; rootId: string }> {
    if (!this.channel) {
      return { chatId: "", rootId: messageId };
    }
    try {
      const rawClient = this.channel.rawClient as unknown as {
        im: {
          v1: {
            message: {
              get: (args: unknown) => Promise<ApiMessageGetResponse>;
            };
          };
        };
      };
      const res = await rawClient.im.v1.message.get({
        path: { message_id: messageId },
      });
      const item = res.data?.items?.[0];
      return {
        chatId: item?.chat_id ?? "",
        rootId: item?.root_id || item?.message_id || messageId,
      };
    } catch (err) {
      this.logger.warn(
        "fetchChatAndRootFor failed, falling back to messageId",
        err
      );
      return { chatId: "", rootId: messageId };
    }
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<NormalizedMessage>> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const { chatId, rootId } = decodeThreadId(threadId);
    const markdown = this.messageToMarkdown(message);
    const result = await this.channel.send(
      chatId,
      { markdown },
      rootId ? { replyTo: rootId } : undefined
    );
    return {
      id: result.messageId,
      threadId,
      raw: result as unknown as NormalizedMessage,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<NormalizedMessage>> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const markdown = this.messageToMarkdown(message);
    // Use SDK's editMessage rather than raw message.patch: the SDK handles
    // the post-vs-text content format matching required by Lark's patch
    // API (mismatch → 400 format_error).
    await this.channel.editMessage(messageId, markdown);
    return {
      id: messageId,
      threadId,
      raw: {} as NormalizedMessage,
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    await this.channel.recallMessage(messageId);
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<NormalizedMessage>> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const { chatId, rootId } = decodeThreadId(threadId);
    const result = await this.channel.stream(
      chatId,
      {
        markdown: async (controller) => {
          for await (const chunk of textStream) {
            if (typeof chunk === "string") {
              if (chunk) {
                await controller.append(chunk);
              }
              continue;
            }
            if (chunk.type === "markdown_text" && chunk.text) {
              await controller.append(chunk.text);
            }
            // task_update / plan_update: silently skipped — Lark has no native
            // equivalent for progress cards. If needed later, we can serialize
            // them as inline text. For now we mirror the SDK contract: only
            // markdown_text contributes to the streaming card body.
          }
        },
      },
      rootId ? { replyTo: rootId } : undefined
    );
    return {
      id: result.messageId,
      threadId,
      raw: result as unknown as NormalizedMessage,
    };
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // Lark has no typing indicator API; no-op.
  }

  // -------------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------------

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const emojiType = toLarkEmojiType(emoji);
    // SDK exposes `channel.addReaction` directly — use it instead of the
    // raw `im.v1.messageReaction.create` path (which also works but the
    // wrapper handles auth and errors consistently).
    await this.channel.addReaction(messageId, emojiType);
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const emojiType = toLarkEmojiType(emoji);
    // SDK's removeReactionByEmoji lists the message's reactions filtered
    // by emoji, finds the one added by this bot, and deletes it. Returns
    // `false` if no matching bot reaction exists.
    const removed = await this.channel.removeReactionByEmoji(
      messageId,
      emojiType
    );
    if (!removed) {
      throw new ValidationError(
        "lark",
        `No reaction of type "${emojiType}" added by this bot on message ${messageId}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Fetching
  // -------------------------------------------------------------------------

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<NormalizedMessage>> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const { chatId } = decodeThreadId(threadId);
    const direction = options?.direction ?? "backward";
    const sortType =
      direction === "forward" ? "ByCreateTimeAsc" : "ByCreateTimeDesc";
    const rawClient = this.channel.rawClient as unknown as {
      im: {
        v1: {
          message: {
            list: (args: unknown) => Promise<ApiMessageListResponse>;
          };
        };
      };
    };
    const res = await rawClient.im.v1.message.list({
      params: {
        container_id_type: "chat",
        container_id: chatId,
        sort_type: sortType,
        page_token: options?.cursor,
        page_size: options?.limit ?? 50,
      },
    });
    const items = res.data?.items ?? [];
    const messages = await Promise.all(
      items.map((item) => this.apiMessageToMessage(item, chatId))
    );
    const nextCursor = res.data?.has_more ? res.data.page_token : undefined;
    return { messages, nextCursor };
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<NormalizedMessage> | null> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const rawClient = this.channel.rawClient as unknown as {
      im: {
        v1: {
          message: {
            get: (args: unknown) => Promise<{
              data?: { items?: ApiMessageItem[] };
            }>;
          };
        };
      };
    };
    const res = await rawClient.im.v1.message.get({
      path: { message_id: messageId },
    });
    const item = res.data?.items?.[0];
    if (!item) {
      return null;
    }
    const { chatId } = decodeThreadId(threadId);
    return this.apiMessageToMessage(item, chatId);
  }

  async listThreads(
    channelId: string,
    options?: ListThreadsOptions
  ): Promise<ListThreadsResult<NormalizedMessage>> {
    if (!this.channel) {
      throw new Error("LarkAdapter not initialized");
    }
    const rawClient = this.channel.rawClient as unknown as {
      im: {
        v1: {
          message: {
            list: (args: unknown) => Promise<ApiMessageListResponse>;
          };
        };
      };
    };
    // Lark has no native "list threads" API. We list messages on the chat
    // and group them by root_id — a message with no root is its own root.
    // Pagination follows Lark's page_token, which advances through messages
    // rather than threads; caller iterates pages until it has enough.
    const res = await rawClient.im.v1.message.list({
      params: {
        container_id_type: "chat",
        container_id: channelId,
        sort_type: "ByCreateTimeDesc",
        page_token: options?.cursor,
        page_size: options?.limit ?? 50,
      },
    });
    const items = res.data?.items ?? [];
    const byRootId = new Map<
      string,
      { root: ApiMessageItem | null; lastReplyAt: number; replyCount: number }
    >();
    for (const item of items) {
      const rootId = item.root_id || item.message_id || "";
      if (!rootId) {
        continue;
      }
      const createMs = item.create_time
        ? Number.parseInt(String(item.create_time), 10)
        : 0;
      const group = byRootId.get(rootId);
      if (group) {
        group.replyCount += 1;
        if (createMs > group.lastReplyAt) {
          group.lastReplyAt = createMs;
        }
        if (item.message_id === rootId) {
          group.root = item;
        }
      } else {
        byRootId.set(rootId, {
          root: item.message_id === rootId ? item : null,
          lastReplyAt: createMs,
          replyCount: item.message_id === rootId ? 0 : 1,
        });
      }
    }
    const threads: ThreadSummary<NormalizedMessage>[] = [];
    for (const [rootId, group] of byRootId) {
      // If the root message wasn't in this page, fetch it directly so the
      // summary has a real rootMessage (chat-SDK requires it).
      let rootItem = group.root;
      if (!rootItem) {
        try {
          rootItem = await this.fetchApiMessage(rootId);
        } catch {
          rootItem = null;
        }
      }
      if (!rootItem) {
        continue;
      }
      const rootMessage = await this.apiMessageToMessage(rootItem, channelId);
      threads.push({
        id: encodeThreadId({ chatId: channelId, rootId }),
        rootMessage,
        lastReplyAt:
          group.lastReplyAt > 0 ? new Date(group.lastReplyAt) : undefined,
        replyCount: group.replyCount,
      });
    }
    const nextCursor = res.data?.has_more ? res.data.page_token : undefined;
    return { threads, nextCursor };
  }

  private async fetchApiMessage(
    messageId: string
  ): Promise<ApiMessageItem | null> {
    if (!this.channel) {
      return null;
    }
    const rawClient = this.channel.rawClient as unknown as {
      im: {
        v1: {
          message: {
            get: (args: unknown) => Promise<{
              data?: { items?: ApiMessageItem[] };
            }>;
          };
        };
      };
    };
    const res = await rawClient.im.v1.message.get({
      path: { message_id: messageId },
    });
    return res.data?.items?.[0] ?? null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId, rootId } = decodeThreadId(threadId);
    const channelInfo = await this.safeGetChatInfo(chatId);
    return {
      id: threadId,
      channelId: chatId,
      channelName: channelInfo?.name,
      isDM: this.isDM(threadId),
      metadata: { rootId },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const info = await this.safeGetChatInfo(channelId);
    return {
      id: channelId,
      name: info?.name,
      memberCount: info?.memberCount,
      isDM:
        channelId.startsWith("ou_") ||
        this.p2pChats.has(channelId) ||
        info?.chatType === "p2p",
      metadata: info
        ? {
            description: info.description,
            ownerId: info.ownerId,
            chatType: info.chatType,
          }
        : {},
    };
  }

  /**
   * Wrap `channel.getChatInfo` with defensive error handling. Lark returns
   * 403 for chats the bot isn't a member of, or for user open_ids (which
   * aren't real chats). We don't want those to break the caller — return
   * undefined and let the caller fall back.
   */
  private async safeGetChatInfo(chatId: string) {
    if (!this.channel) {
      return undefined;
    }
    if (chatId.startsWith("ou_")) {
      // openDM placeholder — there's no real chat to query yet
      return undefined;
    }
    try {
      return await this.channel.getChatInfo(chatId);
    } catch (err) {
      this.logger.debug("getChatInfo failed", { chatId, err });
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // DM
  // -------------------------------------------------------------------------

  async openDM(userId: string): Promise<string> {
    return encodeThreadId({ chatId: userId, rootId: "" });
  }

  /**
   * Decide whether a thread is a DM (p2p).
   *
   * Two cases:
   * - `ou_*` chatId — an openDM placeholder. Always DM.
   * - `oc_*` chatId — could be group OR p2p. We only know it's p2p if
   *   we've seen a message event on that chat with chatType='p2p' and
   *   cached it in `this.p2pChats`.
   *
   * A `false` for an unknown `oc_*` chat is approximate but safe: if the
   * chat is actually a DM we'll learn it from the next message event and
   * subsequent calls will return true.
   */
  isDM(threadId: string): boolean {
    const { chatId } = decodeThreadId(threadId);
    if (chatId.startsWith("ou_")) {
      return true;
    }
    return this.p2pChats.has(chatId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert an AdapterPostableMessage to a markdown string for LarkChannel.
   * LarkChannel handles markdown→post→split→upload→retry internally.
   */
  private messageToMarkdown(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return message.markdown;
    }
    if ("ast" in message) {
      return stringifyMarkdown(message.ast);
    }
    if ("card" in message) {
      return message.fallbackText ?? "";
    }
    // CardElement — rare; fallback to empty string. P1 extension: render
    // the card element through renderPostable-style conversion.
    return "";
  }

  /**
   * Adapt a Lark API message list/get item to a chat-SDK Message.
   *
   * Shape differences from WS events:
   *   - API's `body.content` mirrors the WS `message.content` JSON string
   *   - API `sender.id` + `id_type` replaces WS `sender.sender_id.{open_id,...}`
   *   - API does NOT carry `chat_type` — we infer: cached p2p → 'p2p',
   *     else 'group' (sufficient for normalize(), which only consults
   *     chat_type through context; wrong label here doesn't change the
   *     resulting NormalizedMessage content)
   *
   * We shim the item into a RawMessageEvent and delegate to SDK's
   * `normalize()`, which handles all 23 message types.
   */
  private async apiMessageToMessage(
    item: ApiMessageItem,
    fallbackChatId: string
  ): Promise<Message<NormalizedMessage>> {
    const shim = this.apiMessageItemToRawEvent(item, fallbackChatId);
    const nm = this.channel?.botIdentity
      ? await normalize(shim, { botIdentity: this.channel.botIdentity })
      : this.buildFallbackNormalized(item, fallbackChatId);
    return this.parseMessage(nm);
  }

  /**
   * Translate an `ApiMessageItem.sender` into the `RawMessageEvent.sender_id`
   * shape. Lark's history API marks bot-authored messages with
   * `id_type: "app_id"` + `id: "cli_xxx"` — which has no slot in the event
   * schema. We resolve it to the bot's own open_id via `botIdentity`.
   */
  private buildSenderIdField(
    item: ApiMessageItem,
    botOpenId: string | undefined
  ): RawMessageEvent["sender"]["sender_id"] {
    const sender = item.sender;
    if (sender?.id_type === "app_id" && sender.id === this.appId) {
      return { open_id: botOpenId };
    }
    if (sender?.id_type === "user_id") {
      return { user_id: sender.id };
    }
    if (sender?.id_type === "union_id") {
      return { union_id: sender.id };
    }
    return { open_id: sender?.id };
  }

  private apiMessageItemToRawEvent(
    item: ApiMessageItem,
    fallbackChatId: string
  ): RawMessageEvent {
    const chatId = item.chat_id ?? fallbackChatId;
    const chatType: RawMessageEvent["message"]["chat_type"] = this.p2pChats.has(
      chatId
    )
      ? "p2p"
      : "group";
    // Lark's history API (im.v1.messages.{list,get}) returns bot-authored
    // messages with `sender.id_type: "app_id"` + `sender.id: "cli_xxx"`.
    // RawMessageEvent.sender.sender_id has no slot for app_id, and naively
    // stuffing cli_xxx into open_id breaks downstream `isMe` checks. We
    // resolve it here: if the sender is our own app, substitute the bot's
    // open_id (which we have from botIdentity).
    const botOpenId = this.channel?.botIdentity?.openId;
    const senderIdField = this.buildSenderIdField(item, botOpenId);
    return {
      sender: {
        sender_id: senderIdField,
        sender_type: item.sender?.sender_type,
        tenant_key: item.sender?.tenant_key,
      },
      message: {
        message_id: item.message_id ?? "",
        root_id: item.root_id,
        parent_id: item.parent_id,
        thread_id: item.thread_id,
        create_time: item.create_time ? String(item.create_time) : undefined,
        update_time: item.update_time,
        chat_id: chatId,
        chat_type: chatType,
        message_type: item.msg_type ?? "text",
        content: item.body?.content ?? "{}",
        mentions: item.mentions,
      },
    };
  }

  /**
   * Fallback when bot identity isn't known yet (e.g., fetching before
   * initialize() finishes). Produces a best-effort NormalizedMessage with
   * raw JSON content — callers should normally wait for initialize().
   */
  private buildFallbackNormalized(
    item: ApiMessageItem,
    fallbackChatId: string
  ): NormalizedMessage {
    return {
      messageId: item.message_id ?? "",
      chatId: item.chat_id ?? fallbackChatId,
      chatType: this.p2pChats.has(item.chat_id ?? fallbackChatId)
        ? "p2p"
        : "group",
      senderId: item.sender?.id ?? "",
      content: item.body?.content ?? "",
      rawContentType: item.msg_type ?? "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
      rootId: item.root_id,
      threadId: item.thread_id,
      replyToMessageId: item.parent_id,
      createTime: item.create_time
        ? Number.parseInt(String(item.create_time), 10)
        : 0,
    };
  }

  // -------------------------------------------------------------------------
  // @internal accessors (for tests / debugging)
  // -------------------------------------------------------------------------

  /** @internal */
  _getChannel(): LarkChannel | null {
    return this.channel;
  }

  /** @internal */
  _getLogger(): Logger {
    return this.logger;
  }
}

export function createLarkAdapter(config: LarkAdapterConfig = {}): LarkAdapter {
  return new LarkAdapter(config);
}
