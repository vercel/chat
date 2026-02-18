import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type { Root } from "mdast";
import { cardToFallbackText } from "./cards";
import { ChannelImpl, deriveChannelId } from "./channel";
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
  Attachment,
  Author,
  Channel,
  EphemeralMessage,
  PostableMessage,
  PostEphemeralOptions,
  SentMessage,
  StateAdapter,
  StreamOptions,
  Thread,
} from "./types";
import { THREAD_STATE_TTL_MS } from "./types";

/**
 * Serialized thread data for passing to external systems (e.g., workflow engines).
 */
export interface SerializedThread {
  _type: "chat:Thread";
  id: string;
  channelId: string;
  isDM: boolean;
  adapterName: string;
}

/**
 * Config for creating a ThreadImpl with explicit adapter/state instances.
 */
interface ThreadImplConfigWithAdapter {
  id: string;
  adapter: Adapter;
  channelId: string;
  stateAdapter: StateAdapter;
  initialMessage?: Message;
  isSubscribedContext?: boolean;
  isDM?: boolean;
  currentMessage?: Message;
  streamingUpdateIntervalMs?: number;
}

/**
 * Config for creating a ThreadImpl with lazy adapter resolution.
 * The adapter will be looked up from the Chat singleton on first access.
 */
interface ThreadImplConfigLazy {
  id: string;
  adapterName: string;
  channelId: string;
  initialMessage?: Message;
  isSubscribedContext?: boolean;
  isDM?: boolean;
  currentMessage?: Message;
  streamingUpdateIntervalMs?: number;
}

type ThreadImplConfig = ThreadImplConfigWithAdapter | ThreadImplConfigLazy;

function isLazyConfig(
  config: ThreadImplConfig,
): config is ThreadImplConfigLazy {
  return "adapterName" in config && !("adapter" in config);
}

/** State key prefix for thread state */
const THREAD_STATE_KEY_PREFIX = "thread-state:";

/**
 * Check if a value is an AsyncIterable (like AI SDK's textStream).
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  return (
    value !== null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

export class ThreadImpl<TState = Record<string, unknown>>
  implements Thread<TState>
{
  readonly id: string;
  readonly channelId: string;
  readonly isDM: boolean;

  /** Direct adapter instance (if provided) */
  private _adapter?: Adapter;
  /** Adapter name for lazy resolution */
  private _adapterName?: string;
  /** Direct state adapter instance (if provided) */
  private _stateAdapterInstance?: StateAdapter;
  private _recentMessages: Message[] = [];
  private _isSubscribedContext: boolean;
  /** Current message context for streaming - provides userId/teamId */
  private _currentMessage?: Message;
  /** Update interval for fallback streaming */
  private _streamingUpdateIntervalMs: number;
  /** Cached channel instance */
  private _channel?: Channel<TState>;

  constructor(config: ThreadImplConfig) {
    this.id = config.id;
    this.channelId = config.channelId;
    this.isDM = config.isDM ?? false;
    this._isSubscribedContext = config.isSubscribedContext ?? false;
    this._currentMessage = config.currentMessage;
    this._streamingUpdateIntervalMs = config.streamingUpdateIntervalMs ?? 500;

    if (isLazyConfig(config)) {
      // Lazy resolution mode - store adapter name for later lookup
      this._adapterName = config.adapterName;
    } else {
      // Direct mode - store adapter and state instances
      this._adapter = config.adapter;
      this._stateAdapterInstance = config.stateAdapter;
    }

    if (config.initialMessage) {
      this._recentMessages = [config.initialMessage];
    }
  }

  /**
   * Get the adapter for this thread.
   * If created with lazy config, resolves from Chat singleton on first access.
   */
  get adapter(): Adapter {
    if (this._adapter) {
      return this._adapter;
    }

    if (!this._adapterName) {
      throw new Error("Thread has no adapter configured");
    }

    // Lazy resolution from singleton
    const chat = getChatSingleton();
    const adapter = chat.getAdapter(this._adapterName);
    if (!adapter) {
      throw new Error(
        `Adapter "${this._adapterName}" not found in Chat singleton`,
      );
    }

    // Cache for subsequent accesses
    this._adapter = adapter;
    return adapter;
  }

  /**
   * Get the state adapter for this thread.
   * If created with lazy config, resolves from Chat singleton on first access.
   */
  private get _stateAdapter(): StateAdapter {
    if (this._stateAdapterInstance) {
      return this._stateAdapterInstance;
    }

    // Lazy resolution from singleton
    const chat = getChatSingleton();
    this._stateAdapterInstance = chat.getState();
    return this._stateAdapterInstance;
  }

  get recentMessages(): Message[] {
    return this._recentMessages;
  }

  set recentMessages(messages: Message[]) {
    this._recentMessages = messages;
  }

  /**
   * Get the current thread state.
   * Returns null if no state has been set.
   */
  get state(): Promise<TState | null> {
    return this._stateAdapter.get<TState>(
      `${THREAD_STATE_KEY_PREFIX}${this.id}`,
    );
  }

  /**
   * Set the thread state. Merges with existing state by default.
   * State is persisted for 30 days.
   */
  async setState(
    newState: Partial<TState>,
    options?: { replace?: boolean },
  ): Promise<void> {
    const key = `${THREAD_STATE_KEY_PREFIX}${this.id}`;

    if (options?.replace) {
      // Replace entire state
      await this._stateAdapter.set(key, newState, THREAD_STATE_TTL_MS);
    } else {
      // Merge with existing state
      const existing = await this._stateAdapter.get<TState>(key);
      const merged = { ...existing, ...newState };
      await this._stateAdapter.set(key, merged, THREAD_STATE_TTL_MS);
    }
  }

  /**
   * Get the Channel containing this thread.
   * Lazy-created and cached.
   */
  get channel(): Channel<TState> {
    if (!this._channel) {
      const channelId = deriveChannelId(this.adapter, this.id);
      this._channel = new ChannelImpl<TState>({
        id: channelId,
        adapter: this.adapter,
        stateAdapter: this._stateAdapter,
        isDM: this.isDM,
      });
    }
    return this._channel;
  }

  /**
   * Iterate messages newest first (backward from most recent).
   * Auto-paginates lazily.
   */
  get messages(): AsyncIterable<Message> {
    const adapter = this.adapter;
    const threadId = this.id;

    return {
      async *[Symbol.asyncIterator]() {
        let cursor: string | undefined;

        while (true) {
          const result = await adapter.fetchMessages(threadId, {
            cursor,
            direction: "backward",
          });

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

  get allMessages(): AsyncIterable<Message> {
    const adapter = this.adapter;
    const threadId = this.id;

    return {
      async *[Symbol.asyncIterator]() {
        let cursor: string | undefined;

        while (true) {
          // Use forward direction to iterate from oldest to newest
          const result = await adapter.fetchMessages(threadId, {
            limit: 100,
            cursor,
            direction: "forward",
          });

          for (const message of result.messages) {
            yield message;
          }

          // No more pages if no nextCursor or no messages returned
          if (!result.nextCursor || result.messages.length === 0) {
            break;
          }

          cursor = result.nextCursor;
        }
      },
    };
  }

  async isSubscribed(): Promise<boolean> {
    // Short-circuit if we know we're in a subscribed context
    if (this._isSubscribedContext) {
      return true;
    }
    return this._stateAdapter.isSubscribed(this.id);
  }

  async subscribe(): Promise<void> {
    await this._stateAdapter.subscribe(this.id);
    // Allow adapters to set up platform-specific subscriptions
    if (this.adapter.onThreadSubscribe) {
      await this.adapter.onThreadSubscribe(this.id);
    }
  }

  async unsubscribe(): Promise<void> {
    await this._stateAdapter.unsubscribe(this.id);
  }

  async post(
    message: string | PostableMessage | CardJSXElement,
  ): Promise<SentMessage> {
    // Handle AsyncIterable (streaming)
    if (isAsyncIterable(message)) {
      return this.handleStream(message);
    }

    // After filtering out streams, we have an AdapterPostableMessage
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

    const rawMessage = await this.adapter.postMessage(this.id, postable);

    // Create a SentMessage with edit/delete capabilities
    const result = this.createSentMessage(
      rawMessage.id,
      postable,
      rawMessage.threadId,
    );
    return result;
  }

  async postEphemeral(
    user: string | Author,
    message: AdapterPostableMessage | CardJSXElement,
    options: PostEphemeralOptions,
  ): Promise<EphemeralMessage | null> {
    const { fallbackToDM } = options;
    const userId = typeof user === "string" ? user : user.userId;

    // Convert JSX to card if needed
    let postable: AdapterPostableMessage;
    if (isJSX(message)) {
      const card = toCardElement(message);
      if (!card) {
        throw new Error("Invalid JSX element: must be a Card element");
      }
      postable = card;
    } else {
      // Safe cast: if not JSX, it must be AdapterPostableMessage
      postable = message as AdapterPostableMessage;
    }

    // Try native ephemeral if adapter supports it
    if (this.adapter.postEphemeral) {
      return this.adapter.postEphemeral(this.id, userId, postable);
    }

    // No native support - either fallback to DM or return null
    if (!fallbackToDM) {
      return null;
    }

    // Fallback: send via DM
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

    // No DM support either - return null
    return null;
  }

  /**
   * Handle streaming from an AsyncIterable.
   * Uses adapter's native streaming if available, otherwise falls back to post+edit.
   */
  private async handleStream(
    textStream: AsyncIterable<string>,
  ): Promise<SentMessage> {
    // Build streaming options from current message context
    const options: StreamOptions = {};
    if (this._currentMessage) {
      options.recipientUserId = this._currentMessage.author.userId;
      // Extract teamId from raw Slack payload
      const raw = this._currentMessage.raw as {
        team_id?: string;
        team?: string;
      };
      options.recipientTeamId = raw?.team_id ?? raw?.team;
    }

    // Use native streaming if adapter supports it
    if (this.adapter.stream) {
      // Wrap stream to collect accumulated text while passing through to adapter
      let accumulated = "";
      const wrappedStream: AsyncIterable<string> = {
        [Symbol.asyncIterator]: () => {
          const iterator = textStream[Symbol.asyncIterator]();
          return {
            async next() {
              const result = await iterator.next();
              if (!result.done) {
                accumulated += result.value;
              }
              return result;
            },
          };
        },
      };

      const raw = await this.adapter.stream(this.id, wrappedStream, options);
      return this.createSentMessage(raw.id, accumulated, raw.threadId);
    }

    // Fallback: post + edit with throttling
    return this.fallbackStream(textStream, options);
  }

  async startTyping(): Promise<void> {
    await this.adapter.startTyping(this.id);
  }

  /**
   * Fallback streaming implementation using post + edit.
   * Used when adapter doesn't support native streaming.
   * Uses recursive setTimeout to send updates every intervalMs (default 500ms).
   * Schedules next update only after current edit completes to avoid overwhelming slow services.
   */
  private async fallbackStream(
    textStream: AsyncIterable<string>,
    options?: StreamOptions,
  ): Promise<SentMessage> {
    const intervalMs =
      options?.updateIntervalMs ?? this._streamingUpdateIntervalMs;
    const msg = await this.adapter.postMessage(this.id, "...");

    // Use the threadId from postMessage for edits (may differ if adapter created a thread)
    const threadIdForEdits = msg.threadId || this.id;

    let accumulated = "";
    let lastEditContent = "..."; // Track that we posted "..." initially
    let stopped = false;
    let pendingEdit: Promise<void> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const doEditAndReschedule = async (): Promise<void> => {
      if (stopped) return;

      if (accumulated !== lastEditContent) {
        const content = accumulated;
        try {
          await this.adapter.editMessage(threadIdForEdits, msg.id, content);
          lastEditContent = content;
        } catch {
          // Ignore errors, continue
        }
      }

      // Schedule next check after intervalMs (only after edit completes)
      if (!stopped) {
        timerId = setTimeout(() => {
          pendingEdit = doEditAndReschedule();
        }, intervalMs);
      }
    };

    // Start the first timeout
    timerId = setTimeout(() => {
      pendingEdit = doEditAndReschedule();
    }, intervalMs);

    try {
      for await (const chunk of textStream) {
        accumulated += chunk;
      }
    } finally {
      stopped = true;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    }

    // Wait for any pending edit to complete
    if (pendingEdit) {
      await pendingEdit;
    }

    // Final edit to ensure all content is shown (including empty stream replacing "...")
    if (accumulated !== lastEditContent) {
      await this.adapter.editMessage(threadIdForEdits, msg.id, accumulated);
    }

    return this.createSentMessage(msg.id, accumulated, threadIdForEdits);
  }

  async refresh(): Promise<void> {
    const result = await this.adapter.fetchMessages(this.id, { limit: 50 });
    this._recentMessages = result.messages;
  }

  mentionUser(userId: string): string {
    return `<@${userId}>`;
  }

  /**
   * Serialize the thread to a plain JSON object.
   * Use this to pass thread data to external systems like workflow engines.
   *
   * @example
   * ```typescript
   * // Pass to a workflow
   * await workflow.start("my-workflow", {
   *   thread: thread.toJSON(),
   *   message: serializeMessage(message),
   * });
   * ```
   */
  toJSON(): SerializedThread {
    return {
      _type: "chat:Thread",
      id: this.id,
      channelId: this.channelId,
      isDM: this.isDM,
      adapterName: this.adapter.name,
    };
  }

  /**
   * Reconstruct a Thread from serialized JSON data.
   *
   * Reconstructs a ThreadImpl from serialized data.
   * Uses lazy resolution from Chat.getSingleton() for adapter and state.
   *
   * @param json - Serialized thread data
   * @requires Call `chat.registerSingleton()` before deserializing threads
   *
   * @example
   * ```typescript
   * const thread = ThreadImpl.fromJSON(serializedThread);
   * ```
   */
  static fromJSON<TState = Record<string, unknown>>(
    json: SerializedThread,
    adapter?: Adapter,
  ): ThreadImpl<TState> {
    const thread = new ThreadImpl<TState>({
      id: json.id,
      adapterName: json.adapterName,
      channelId: json.channelId,
      isDM: json.isDM,
    });
    if (adapter) {
      thread._adapter = adapter;
    }
    return thread;
  }

  /**
   * Serialize a ThreadImpl instance for @workflow/serde.
   * This static method is automatically called by workflow serialization.
   */
  static [WORKFLOW_SERIALIZE](instance: ThreadImpl): SerializedThread {
    return instance.toJSON();
  }

  /**
   * Deserialize a ThreadImpl from @workflow/serde.
   * Uses lazy adapter resolution from Chat.getSingleton().
   * Requires chat.registerSingleton() to have been called.
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedThread): ThreadImpl {
    return ThreadImpl.fromJSON(data);
  }

  private createSentMessage(
    messageId: string,
    postable: AdapterPostableMessage,
    threadIdOverride?: string,
  ): SentMessage {
    const adapter = this.adapter;
    // Use the threadId returned by postMessage if available (may differ after thread creation)
    const threadId = threadIdOverride || this.id;
    const self = this;

    // Extract text and AST from the PostableMessage
    const { plainText, formatted, attachments } =
      extractMessageContent(postable);

    const sentMessage: SentMessage = {
      id: messageId,
      threadId,
      text: plainText,
      formatted,
      raw: null, // Will be populated if needed
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
        // Auto-convert JSX elements to CardElement
        // edit doesn't support streaming, so use AdapterPostableMessage
        let postable: string | AdapterPostableMessage = newContent as
          | string
          | AdapterPostableMessage;
        if (isJSX(newContent)) {
          const card = toCardElement(newContent);
          if (!card) {
            throw new Error("Invalid JSX element: must be a Card element");
          }
          postable = card;
        }
        await adapter.editMessage(threadId, messageId, postable);
        return self.createSentMessage(messageId, postable);
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

  createSentMessageFromMessage(message: Message): SentMessage {
    const adapter = this.adapter;
    const threadId = this.id;
    const messageId = message.id;
    const self = this;

    return {
      id: message.id,
      threadId: message.threadId,
      text: message.text,
      formatted: message.formatted,
      raw: message.raw,
      author: message.author,
      metadata: message.metadata,
      attachments: message.attachments,
      isMention: message.isMention,

      toJSON() {
        return message.toJSON();
      },

      async edit(
        newContent: string | PostableMessage | CardJSXElement,
      ): Promise<SentMessage> {
        let postable: string | AdapterPostableMessage = newContent as
          | string
          | AdapterPostableMessage;
        if (isJSX(newContent)) {
          const card = toCardElement(newContent);
          if (!card)
            throw new Error("Invalid JSX element: must be a Card element");
          postable = card;
        }
        await adapter.editMessage(threadId, messageId, postable);
        return self.createSentMessage(messageId, postable, threadId);
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
  }
}

/**
 * Extract plain text, AST, and attachments from a message.
 */
function extractMessageContent(message: AdapterPostableMessage): {
  plainText: string;
  formatted: Root;
  attachments: Attachment[];
} {
  if (typeof message === "string") {
    // Raw string - create simple AST
    return {
      plainText: message,
      formatted: root([paragraph([textNode(message)])]),
      attachments: [],
    };
  }

  if ("raw" in message) {
    // Raw text - create simple AST
    return {
      plainText: message.raw,
      formatted: root([paragraph([textNode(message.raw)])]),
      attachments: message.attachments || [],
    };
  }

  if ("markdown" in message) {
    // Markdown - parse to AST
    const ast = parseMarkdown(message.markdown);
    return {
      plainText: toPlainText(ast),
      formatted: ast,
      attachments: message.attachments || [],
    };
  }

  if ("ast" in message) {
    // AST provided directly
    return {
      plainText: toPlainText(message.ast),
      formatted: message.ast,
      attachments: message.attachments || [],
    };
  }

  if ("card" in message) {
    // PostableCard - generate fallback text from card
    const fallbackText =
      message.fallbackText || cardToFallbackText(message.card);
    return {
      plainText: fallbackText,
      formatted: root([paragraph([textNode(fallbackText)])]),
      attachments: [],
    };
  }

  if ("type" in message && message.type === "card") {
    // Direct CardElement
    const fallbackText = cardToFallbackText(message);
    return {
      plainText: fallbackText,
      formatted: root([paragraph([textNode(fallbackText)])]),
      attachments: [],
    };
  }

  // Should never reach here with proper typing
  throw new Error("Invalid PostableMessage format");
}
