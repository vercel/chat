import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { cardToFallbackText } from "./cards";
import { getChatSingleton } from "./chat-singleton";
import { type CardJSXElement, isJSX, toCardElement } from "./jsx-runtime";
import {
  paragraph,
  parseMarkdown,
  root,
  text as textNode,
  toPlainText,
} from "./markdown";
import { Message } from "./message";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  Channel,
  ChannelInfo,
  EphemeralMessage,
  PostableMessage,
  PostEphemeralOptions,
  SentMessage,
  StateAdapter,
  ThreadSummary,
} from "./types";
import { THREAD_STATE_TTL_MS } from "./types";

/** State key prefix for channel state */
const CHANNEL_STATE_KEY_PREFIX = "channel-state:";

/**
 * Serialized channel data for passing to external systems (e.g., workflow engines).
 */
export interface SerializedChannel {
  _type: "chat:Channel";
  id: string;
  adapterName: string;
  isDM: boolean;
}

/**
 * Config for creating a ChannelImpl with explicit adapter/state instances.
 */
interface ChannelImplConfigWithAdapter {
  id: string;
  adapter: Adapter;
  stateAdapter: StateAdapter;
  isDM?: boolean;
}

/**
 * Config for creating a ChannelImpl with lazy adapter resolution.
 */
interface ChannelImplConfigLazy {
  id: string;
  adapterName: string;
  isDM?: boolean;
}

type ChannelImplConfig = ChannelImplConfigWithAdapter | ChannelImplConfigLazy;

function isLazyConfig(
  config: ChannelImplConfig,
): config is ChannelImplConfigLazy {
  return "adapterName" in config && !("adapter" in config);
}

/**
 * Check if a value is an AsyncIterable (like AI SDK's textStream).
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  return (
    value !== null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

export class ChannelImpl<TState = Record<string, unknown>>
  implements Channel<TState>
{
  readonly id: string;
  readonly isDM: boolean;

  private _adapter?: Adapter;
  private _adapterName?: string;
  private _stateAdapterInstance?: StateAdapter;
  private _name: string | null = null;

  constructor(config: ChannelImplConfig) {
    this.id = config.id;
    this.isDM = config.isDM ?? false;

    if (isLazyConfig(config)) {
      this._adapterName = config.adapterName;
    } else {
      this._adapter = config.adapter;
      this._stateAdapterInstance = config.stateAdapter;
    }
  }

  get adapter(): Adapter {
    if (this._adapter) {
      return this._adapter;
    }

    if (!this._adapterName) {
      throw new Error("Channel has no adapter configured");
    }

    const chat = getChatSingleton();
    const adapter = chat.getAdapter(this._adapterName);
    if (!adapter) {
      throw new Error(
        `Adapter "${this._adapterName}" not found in Chat singleton`,
      );
    }

    this._adapter = adapter;
    return adapter;
  }

  private get _stateAdapter(): StateAdapter {
    if (this._stateAdapterInstance) {
      return this._stateAdapterInstance;
    }

    const chat = getChatSingleton();
    this._stateAdapterInstance = chat.getState();
    return this._stateAdapterInstance;
  }

  get name(): string | null {
    return this._name;
  }

  get state(): Promise<TState | null> {
    return this._stateAdapter.get<TState>(
      `${CHANNEL_STATE_KEY_PREFIX}${this.id}`,
    );
  }

  async setState(
    newState: Partial<TState>,
    options?: { replace?: boolean },
  ): Promise<void> {
    const key = `${CHANNEL_STATE_KEY_PREFIX}${this.id}`;

    if (options?.replace) {
      await this._stateAdapter.set(key, newState, THREAD_STATE_TTL_MS);
    } else {
      const existing = await this._stateAdapter.get<TState>(key);
      const merged = { ...existing, ...newState };
      await this._stateAdapter.set(key, merged, THREAD_STATE_TTL_MS);
    }
  }

  /**
   * Iterate messages newest first (backward from most recent).
   * Uses adapter.fetchChannelMessages if available, otherwise falls back
   * to adapter.fetchMessages with the channel ID.
   */
  get messages(): AsyncIterable<Message> {
    const adapter = this.adapter;
    const channelId = this.id;

    return {
      async *[Symbol.asyncIterator]() {
        let cursor: string | undefined;

        while (true) {
          const fetchOptions = { cursor, direction: "backward" as const };
          const result = adapter.fetchChannelMessages
            ? await adapter.fetchChannelMessages(channelId, fetchOptions)
            : await adapter.fetchMessages(channelId, fetchOptions);

          // Messages within a page are chronological (oldest first),
          // but we want newest first, so reverse the page
          const reversed = [...result.messages].reverse();
          for (const message of reversed) {
            yield message;
          }

          if (!result.nextCursor || result.messages.length === 0) {
            break;
          }

          cursor = result.nextCursor;
        }
      },
    };
  }

  /**
   * Iterate threads in this channel, most recently active first.
   */
  threads(): AsyncIterable<ThreadSummary> {
    const adapter = this.adapter;
    const channelId = this.id;

    return {
      async *[Symbol.asyncIterator]() {
        if (!adapter.listThreads) {
          // Platform doesn't support threading — return empty
          return;
        }

        let cursor: string | undefined;

        while (true) {
          const result = await adapter.listThreads(channelId, {
            cursor,
          });

          for (const thread of result.threads) {
            yield thread;
          }

          if (!result.nextCursor || result.threads.length === 0) {
            break;
          }

          cursor = result.nextCursor;
        }
      },
    };
  }

  async fetchMetadata(): Promise<ChannelInfo> {
    if (this.adapter.fetchChannelInfo) {
      const info = await this.adapter.fetchChannelInfo(this.id);
      this._name = info.name ?? null;
      return info;
    }

    // Fallback: return basic info
    return {
      id: this.id,
      isDM: this.isDM,
      metadata: {},
    };
  }

  async post(
    message: string | PostableMessage | CardJSXElement,
  ): Promise<SentMessage> {
    // Handle AsyncIterable (streaming) — not supported at channel level,
    // fall through to postMessage
    if (isAsyncIterable(message)) {
      // For channel-level streaming, accumulate and post as single message
      let accumulated = "";
      for await (const chunk of message) {
        accumulated += chunk;
      }
      return this.postSingleMessage(accumulated);
    }

    // Auto-convert JSX elements to CardElement
    let postable: string | AdapterPostableMessage = message as
      | string
      | AdapterPostableMessage;
    if (isJSX(message)) {
      const card = toCardElement(message);
      if (!card) {
        throw new Error("Invalid JSX element: must be a Card element");
      }
      postable = card;
    }

    return this.postSingleMessage(postable);
  }

  private async postSingleMessage(
    postable: AdapterPostableMessage,
  ): Promise<SentMessage> {
    const rawMessage = this.adapter.postChannelMessage
      ? await this.adapter.postChannelMessage(this.id, postable)
      : await this.adapter.postMessage(this.id, postable);

    return this.createSentMessage(rawMessage.id, postable, rawMessage.threadId);
  }

  async postEphemeral(
    user: string | Author,
    message: AdapterPostableMessage | CardJSXElement,
    options: PostEphemeralOptions,
  ): Promise<EphemeralMessage | null> {
    const { fallbackToDM } = options;
    const userId = typeof user === "string" ? user : user.userId;

    let postable: AdapterPostableMessage;
    if (isJSX(message)) {
      const card = toCardElement(message);
      if (!card) {
        throw new Error("Invalid JSX element: must be a Card element");
      }
      postable = card;
    } else {
      postable = message as AdapterPostableMessage;
    }

    if (this.adapter.postEphemeral) {
      return this.adapter.postEphemeral(this.id, userId, postable);
    }

    if (!fallbackToDM) {
      return null;
    }

    if (this.adapter.openDM) {
      const dmThreadId = await this.adapter.openDM(userId);
      const result = await this.adapter.postMessage(dmThreadId, postable);
      return {
        id: result.id,
        threadId: dmThreadId,
        usedFallback: true,
        raw: result.raw,
      };
    }

    return null;
  }

  async startTyping(): Promise<void> {
    await this.adapter.startTyping(this.id);
  }

  mentionUser(userId: string): string {
    return `<@${userId}>`;
  }

  toJSON(): SerializedChannel {
    return {
      _type: "chat:Channel",
      id: this.id,
      adapterName: this.adapter.name,
      isDM: this.isDM,
    };
  }

  static fromJSON<TState = Record<string, unknown>>(
    json: SerializedChannel,
    adapter?: Adapter,
  ): ChannelImpl<TState> {
    const channel = new ChannelImpl<TState>({
      id: json.id,
      adapterName: json.adapterName,
      isDM: json.isDM,
    });
    if (adapter) {
      channel._adapter = adapter;
    }
    return channel;
  }

  static [WORKFLOW_SERIALIZE](instance: ChannelImpl): SerializedChannel {
    return instance.toJSON();
  }

  static [WORKFLOW_DESERIALIZE](data: SerializedChannel): ChannelImpl {
    return ChannelImpl.fromJSON(data);
  }

  private createSentMessage(
    messageId: string,
    postable: AdapterPostableMessage,
    threadIdOverride?: string,
  ): SentMessage {
    const adapter = this.adapter;
    const threadId = threadIdOverride || this.id;
    const self = this;

    const { plainText, formatted, attachments } =
      extractMessageContent(postable);

    const sentMessage: SentMessage = {
      id: messageId,
      threadId,
      text: plainText,
      formatted,
      raw: null,
      author: {
        userId: "self",
        userName: adapter.userName,
        fullName: adapter.userName,
        isBot: true,
        isMe: true,
      },
      metadata: {
        dateSent: new Date(),
        edited: false,
      },
      attachments,

      toJSON() {
        return new Message(this).toJSON();
      },

      async edit(
        newContent: string | PostableMessage | CardJSXElement,
      ): Promise<SentMessage> {
        let editPostable: string | AdapterPostableMessage = newContent as
          | string
          | AdapterPostableMessage;
        if (isJSX(newContent)) {
          const card = toCardElement(newContent);
          if (!card) {
            throw new Error("Invalid JSX element: must be a Card element");
          }
          editPostable = card;
        }
        await adapter.editMessage(threadId, messageId, editPostable);
        return self.createSentMessage(messageId, editPostable);
      },

      async delete(): Promise<void> {
        await adapter.deleteMessage(threadId, messageId);
      },

      async addReaction(emoji: string): Promise<void> {
        await adapter.addReaction(threadId, messageId, emoji);
      },

      async removeReaction(emoji: string): Promise<void> {
        await adapter.removeReaction(threadId, messageId, emoji);
      },
    };

    return sentMessage;
  }
}

/**
 * Derive the channel ID from a thread ID.
 * Uses adapter.channelIdFromThreadId if available, otherwise defaults to
 * first two colon-separated parts.
 */
export function deriveChannelId(adapter: Adapter, threadId: string): string {
  if (adapter.channelIdFromThreadId) {
    return adapter.channelIdFromThreadId(threadId);
  }
  // Default: first two colon-separated parts
  const parts = threadId.split(":");
  return parts.slice(0, 2).join(":");
}

/**
 * Extract plain text, AST, and attachments from a message.
 */
function extractMessageContent(message: AdapterPostableMessage): {
  plainText: string;
  formatted: import("mdast").Root;
  attachments: import("./types").Attachment[];
} {
  if (typeof message === "string") {
    return {
      plainText: message,
      formatted: root([paragraph([textNode(message)])]),
      attachments: [],
    };
  }

  if ("raw" in message) {
    return {
      plainText: message.raw,
      formatted: root([paragraph([textNode(message.raw)])]),
      attachments: message.attachments || [],
    };
  }

  if ("markdown" in message) {
    const ast = parseMarkdown(message.markdown);
    return {
      plainText: toPlainText(ast),
      formatted: ast,
      attachments: message.attachments || [],
    };
  }

  if ("ast" in message) {
    return {
      plainText: toPlainText(message.ast),
      formatted: message.ast,
      attachments: message.attachments || [],
    };
  }

  if ("card" in message) {
    const fallbackText =
      message.fallbackText || cardToFallbackText(message.card);
    return {
      plainText: fallbackText,
      formatted: root([paragraph([textNode(fallbackText)])]),
      attachments: [],
    };
  }

  if ("type" in message && message.type === "card") {
    const fallbackText = cardToFallbackText(message);
    return {
      plainText: fallbackText,
      formatted: root([paragraph([textNode(fallbackText)])]),
      attachments: [],
    };
  }

  throw new Error("Invalid PostableMessage format");
}
