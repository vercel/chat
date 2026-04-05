import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type { Root } from "mdast";
import { cardToFallbackText } from "./cards";
import { ChannelImpl, deriveChannelId } from "./channel";
import { getChatSingleton } from "./chat-singleton";
import { fromFullStream } from "./from-full-stream";
import { type ChatElement, isJSX, toCardElement } from "./jsx-runtime";
import type { Logger } from "./logger";
import {
  paragraph,
  parseMarkdown,
  root,
  text as textNode,
  toPlainText,
} from "./markdown";
import { Message, type SerializedMessage } from "./message";
import type { MessageHistoryCache } from "./message-history";
import { isPostableObject, postPostableObject } from "./postable-object";
import { StreamingMarkdownRenderer } from "./streaming-markdown";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  Channel,
  ChannelVisibility,
  EphemeralMessage,
  PostableMessage,
  PostableObject,
  PostEphemeralOptions,
  ScheduledMessage,
  SentMessage,
  StateAdapter,
  StreamChunk,
  StreamEvent,
  StreamOptions,
  Thread,
} from "./types";
import { NotImplementedError, THREAD_STATE_TTL_MS } from "./types";

/**
 * Serialized thread data for passing to external systems (e.g., workflow engines).
 */
export interface SerializedThread {
  _type: "chat:Thread";
  adapterName: string;
  channelId: string;
  channelVisibility?: ChannelVisibility;
  currentMessage?: SerializedMessage;
  id: string;
  isDM: boolean;
}

/**
 * Config for creating a ThreadImpl with explicit adapter/state instances.
 */
interface ThreadImplConfigWithAdapter {
  adapter: Adapter;
  channelId: string;
  channelVisibility?: ChannelVisibility;
  currentMessage?: Message;
  fallbackStreamingPlaceholderText?: string | null;
  id: string;
  initialMessage?: Message;
  isDM?: boolean;
  isSubscribedContext?: boolean;
  logger?: Logger;
  messageHistory?: MessageHistoryCache;
  stateAdapter: StateAdapter;
  streamingUpdateIntervalMs?: number;
}

/**
 * Config for creating a ThreadImpl with lazy adapter resolution.
 * The adapter will be looked up from the Chat singleton on first access.
 */
interface ThreadImplConfigLazy {
  adapterName: string;
  channelId: string;
  channelVisibility?: ChannelVisibility;
  currentMessage?: Message;
  fallbackStreamingPlaceholderText?: string | null;
  id: string;
  initialMessage?: Message;
  isDM?: boolean;
  isSubscribedContext?: boolean;
  logger?: Logger;
  streamingUpdateIntervalMs?: number;
}

type ThreadImplConfig = ThreadImplConfigWithAdapter | ThreadImplConfigLazy;

function isLazyConfig(
  config: ThreadImplConfig
): config is ThreadImplConfigLazy {
  return "adapterName" in config && !("adapter" in config);
}

/** State key prefix for thread state */
const THREAD_STATE_KEY_PREFIX = "thread-state:";

/**
 * Check if a value is an AsyncIterable (like AI SDK's textStream or fullStream).
 */
function isAsyncIterable(
  value: unknown
): value is AsyncIterable<string | StreamChunk | StreamEvent> {
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
  readonly channelVisibility: ChannelVisibility;

  /** Direct adapter instance (if provided) */
  private _adapter?: Adapter;
  /** Adapter name for lazy resolution */
  private readonly _adapterName?: string;
  /** Direct state adapter instance (if provided) */
  private _stateAdapterInstance?: StateAdapter;
  private _recentMessages: Message[] = [];
  private readonly _isSubscribedContext: boolean;
  /** Current message context for streaming - provides userId/teamId */
  private readonly _currentMessage?: Message;
  /** Update interval for fallback streaming */
  private readonly _streamingUpdateIntervalMs: number;
  /** Placeholder text for fallback streaming (post + edit) */
  private readonly _fallbackStreamingPlaceholderText: string | null;
  /** Cached channel instance */
  private _channel?: Channel<TState>;
  /** Message history cache (set only for adapters with persistMessageHistory) */
  private readonly _messageHistory?: MessageHistoryCache;
  private readonly _logger?: Logger;

  constructor(config: ThreadImplConfig) {
    this.id = config.id;
    this.channelId = config.channelId;
    this.isDM = config.isDM ?? false;
    this.channelVisibility = config.channelVisibility ?? "unknown";
    this._isSubscribedContext = config.isSubscribedContext ?? false;
    this._currentMessage = config.currentMessage;
    this._logger = config.logger;
    this._streamingUpdateIntervalMs = config.streamingUpdateIntervalMs ?? 500;
    this._fallbackStreamingPlaceholderText =
      config.fallbackStreamingPlaceholderText !== undefined
        ? config.fallbackStreamingPlaceholderText
        : "...";

    if (isLazyConfig(config)) {
      // Lazy resolution mode - store adapter name for later lookup
      this._adapterName = config.adapterName;
    } else {
      // Direct mode - store adapter and state instances
      this._adapter = config.adapter;
      this._stateAdapterInstance = config.stateAdapter;
      this._messageHistory = config.messageHistory;
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
        `Adapter "${this._adapterName}" not found in Chat singleton`
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
      `${THREAD_STATE_KEY_PREFIX}${this.id}`
    );
  }

  /**
   * Set the thread state. Merges with existing state by default.
   * State is persisted for 30 days.
   */
  async setState(
    newState: Partial<TState>,
    options?: { replace?: boolean }
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
        channelVisibility: this.channelVisibility,
        messageHistory: this._messageHistory,
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
    const messageHistory = this._messageHistory;

    return {
      async *[Symbol.asyncIterator]() {
        let cursor: string | undefined;
        let yieldedAny = false;

        while (true) {
          const result = await adapter.fetchMessages(threadId, {
            cursor,
            direction: "backward",
          });

          // Messages within a page are chronological (oldest first),
          // but we want newest first, so reverse the page
          const reversed = [...result.messages].reverse();
          for (const message of reversed) {
            yieldedAny = true;
            yield message;
          }

          if (!result.nextCursor || result.messages.length === 0) {
            break;
          }

          cursor = result.nextCursor;
        }

        // Fall back to cached history if adapter returned nothing
        if (!yieldedAny && messageHistory) {
          const cached = await messageHistory.getMessages(threadId);
          // Yield newest first
          for (let i = cached.length - 1; i >= 0; i--) {
            yield cached[i];
          }
        }
      },
    };
  }

  get allMessages(): AsyncIterable<Message> {
    const adapter = this.adapter;
    const threadId = this.id;
    const messageHistory = this._messageHistory;

    return {
      async *[Symbol.asyncIterator]() {
        let cursor: string | undefined;
        let yieldedAny = false;

        while (true) {
          // Use forward direction to iterate from oldest to newest
          const result = await adapter.fetchMessages(threadId, {
            limit: 100,
            cursor,
            direction: "forward",
          });

          for (const message of result.messages) {
            yieldedAny = true;
            yield message;
          }

          // No more pages if no nextCursor or no messages returned
          if (!result.nextCursor || result.messages.length === 0) {
            break;
          }

          cursor = result.nextCursor;
        }

        // Fall back to cached history if adapter returned nothing
        if (!yieldedAny && messageHistory) {
          const cached = await messageHistory.getMessages(threadId);
          for (const message of cached) {
            yield message;
          }
        }
      },
    };
  }

  async getParticipants(): Promise<Author[]> {
    const seen = new Map<string, Author>();

    // Include the current message author if available
    if (
      this._currentMessage &&
      !this._currentMessage.author.isMe &&
      !this._currentMessage.author.isBot
    ) {
      seen.set(this._currentMessage.author.userId, this._currentMessage.author);
    }

    // Scan all messages for unique human authors
    for await (const message of this.allMessages) {
      if (
        message.author.isMe ||
        message.author.isBot ||
        seen.has(message.author.userId)
      ) {
        continue;
      }
      seen.set(message.author.userId, message.author);
    }

    return [...seen.values()];
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

  async post<T extends PostableObject>(message: T): Promise<T>;
  async post(
    message:
      | string
      | AdapterPostableMessage
      | AsyncIterable<string>
      | ChatElement
  ): Promise<SentMessage>;
  async post(
    message: string | PostableMessage | ChatElement
  ): Promise<SentMessage | PostableObject> {
    if (isPostableObject(message)) {
      // StreamingPlan PostableObject - route to streaming with options
      if (message.kind === "stream") {
        const data = message.getPostData() as {
          stream: AsyncIterable<string | StreamChunk | StreamEvent>;
          options: {
            groupTasks?: "plan" | "timeline";
            endWith?: unknown[];
            updateIntervalMs?: number;
          };
        };
        const streamOptions: StreamOptions = {
          ...(data.options.updateIntervalMs
            ? { updateIntervalMs: data.options.updateIntervalMs }
            : {}),
          ...(data.options.groupTasks
            ? { taskDisplayMode: data.options.groupTasks }
            : {}),
          ...(data.options.endWith ? { stopBlocks: data.options.endWith } : {}),
        };
        await this.handleStream(data.stream, streamOptions);
        return message;
      }
      await this.handlePostableObject(message);
      return message;
    }

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
      rawMessage.threadId
    );

    // Cache sent message for adapters with persistent history
    if (this._messageHistory) {
      await this._messageHistory.append(this.id, new Message(result));
    }

    return result;
  }

  private async handlePostableObject(obj: PostableObject): Promise<void> {
    await postPostableObject(
      obj,
      this.adapter,
      this.id,
      (threadId, message) => this.adapter.postMessage(threadId, message),
      this._logger
    );
  }

  async postEphemeral(
    user: string | Author,
    message: AdapterPostableMessage | ChatElement,
    options: PostEphemeralOptions
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

  async schedule(
    message: AdapterPostableMessage | ChatElement,
    options: { postAt: Date }
  ): Promise<ScheduledMessage> {
    // Convert JSX to card if needed
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

    if (!this.adapter.scheduleMessage) {
      throw new NotImplementedError(
        "Scheduled messages are not supported by this adapter",
        "scheduling"
      );
    }

    return this.adapter.scheduleMessage(this.id, postable, options);
  }

  /**
   * Handle streaming from an AsyncIterable.
   * Normalizes the stream (supports both textStream and fullStream from AI SDK),
   * then uses adapter's native streaming if available, otherwise falls back to post+edit.
   */
  private async handleStream(
    rawStream: AsyncIterable<string | StreamChunk | StreamEvent>,
    callerOptions?: StreamOptions
  ): Promise<SentMessage> {
    // Normalize: handles plain strings, AI SDK fullStream events, and StreamChunk objects
    const textStream = fromFullStream(rawStream);
    // Build streaming options from current message context + caller options
    const options: StreamOptions = { ...callerOptions };
    if (this._currentMessage) {
      options.recipientUserId = this._currentMessage.author.userId;
      // recipientTeamId is only consumed by the Slack adapter; other adapters
      // ignore it. Derivation is Slack-specific because `currentMessage.raw`
      // shape varies across Slack webhook types (message events vs block_actions).
      options.recipientTeamId = this.extractSlackRecipientTeamId(
        this._currentMessage.raw
      );
    }

    // Use native streaming if adapter supports it
    if (this.adapter.stream) {
      // Wrap stream to collect accumulated text while passing through to adapter.
      // StreamChunk objects are passed through; only plain strings are accumulated.
      let accumulated = "";
      const wrappedStream: AsyncIterable<string | StreamChunk> = {
        [Symbol.asyncIterator]: () => {
          const iterator = textStream[Symbol.asyncIterator]();
          return {
            async next() {
              const result = await iterator.next();
              if (!result.done) {
                const value = result.value;
                if (typeof value === "string") {
                  accumulated += value;
                } else if (value.type === "markdown_text") {
                  accumulated += value.text;
                }
                // task_update and plan_update chunks don't contribute to accumulated text
              }
              return result;
            },
          };
        },
      };

      const raw = await this.adapter.stream(this.id, wrappedStream, options);
      const sent = this.createSentMessage(
        raw.id,
        { markdown: accumulated },
        raw.threadId
      );

      if (this._messageHistory) {
        await this._messageHistory.append(this.id, new Message(sent));
      }

      return sent;
    }

    // Fallback: post + edit with throttling.
    // Extract only text content from the mixed stream for adapters without native streaming.
    const textOnlyStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => {
        const iterator = textStream[Symbol.asyncIterator]();
        return {
          async next(): Promise<IteratorResult<string>> {
            while (true) {
              const result = await iterator.next();
              if (result.done) {
                return { value: undefined as unknown as string, done: true };
              }
              const value = result.value;
              if (typeof value === "string") {
                return { value, done: false };
              }
              if (value.type === "markdown_text") {
                return { value: value.text, done: false };
              }
              // Skip non-text chunks (task_update, plan_update) in fallback mode
            }
          },
        };
      },
    };
    return this.fallbackStream(textOnlyStream, options);
  }

  /**
   * Slack payloads carry the workspace ID in a few different shapes depending on
   * the webhook type:
   * - Message events: `team_id` or `team` as a string
   * - `block_actions` payloads: `team.id` (object), with `user.team_id` as a fallback
   */
  private extractSlackRecipientTeamId(raw: unknown): string | undefined {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }

    const payload = raw as {
      team?: { id?: unknown } | string;
      team_id?: unknown;
      user?: { team_id?: unknown };
    };

    if (typeof payload.team_id === "string" && payload.team_id) {
      return payload.team_id;
    }

    if (typeof payload.team === "string" && payload.team) {
      return payload.team;
    }

    if (
      payload.team &&
      typeof payload.team === "object" &&
      typeof payload.team.id === "string" &&
      payload.team.id
    ) {
      return payload.team.id;
    }

    if (typeof payload.user?.team_id === "string" && payload.user.team_id) {
      return payload.user.team_id;
    }

    return undefined;
  }

  async startTyping(status?: string): Promise<void> {
    await this.adapter.startTyping(this.id, status);
  }

  /**
   * Fallback streaming implementation using post + edit.
   * Used when adapter doesn't support native streaming.
   * Uses recursive setTimeout to send updates every intervalMs (default 500ms).
   * Schedules next update only after current edit completes to avoid overwhelming slow services.
   */
  private async fallbackStream(
    textStream: AsyncIterable<string>,
    options?: StreamOptions
  ): Promise<SentMessage> {
    const intervalMs =
      options?.updateIntervalMs ?? this._streamingUpdateIntervalMs;
    const placeholderText = this._fallbackStreamingPlaceholderText;
    let msg: { id: string; threadId: string; raw: unknown } | null =
      placeholderText === null
        ? null
        : await this.adapter.postMessage(this.id, placeholderText);
    let threadIdForEdits = this.id;
    const renderer = new StreamingMarkdownRenderer();
    let lastEditContent = "";
    let stopped = false;
    let pendingEdit: Promise<void> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    if (msg) {
      threadIdForEdits = msg.threadId || this.id;
      lastEditContent = placeholderText ?? "";
    }

    const scheduleNextEdit = (): void => {
      timerId = setTimeout(() => {
        pendingEdit = doEditAndReschedule();
      }, intervalMs);
    };

    const doEditAndReschedule = async (): Promise<void> => {
      if (stopped || !msg) {
        return;
      }

      const content = renderer.render();
      if (content.trim() && content !== lastEditContent) {
        try {
          await this.adapter.editMessage(threadIdForEdits, msg.id, {
            markdown: content,
          });
          lastEditContent = content;
        } catch (error) {
          this._logger?.warn("fallbackStream edit failed", error);
        }
      }

      // Schedule next check after intervalMs (only after edit completes)
      if (!stopped) {
        scheduleNextEdit();
      }
    };

    if (msg) {
      scheduleNextEdit();
    }

    try {
      for await (const chunk of textStream) {
        renderer.push(chunk);
        if (!msg) {
          const content = renderer.render();
          if (content.trim()) {
            msg = await this.adapter.postMessage(this.id, {
              markdown: content,
            });
            threadIdForEdits = msg.threadId || this.id;
            lastEditContent = content;
            scheduleNextEdit();
          }
        }
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

    const accumulated = renderer.getText();
    const finalContent = renderer.finish();

    if (!msg) {
      msg = await this.adapter.postMessage(this.id, {
        markdown: accumulated.trim() ? accumulated : " ",
      });
      threadIdForEdits = msg.threadId || this.id;
      lastEditContent = accumulated;
    }

    if (finalContent.trim() && finalContent !== lastEditContent) {
      await this.adapter.editMessage(threadIdForEdits, msg.id, {
        markdown: accumulated,
      });
    }

    const sent = this.createSentMessage(
      msg.id,
      { markdown: accumulated },
      threadIdForEdits
    );

    if (this._messageHistory) {
      await this._messageHistory.append(this.id, new Message(sent));
    }

    return sent;
  }

  async refresh(): Promise<void> {
    const result = await this.adapter.fetchMessages(this.id, { limit: 50 });
    if (result.messages.length > 0) {
      this._recentMessages = result.messages;
    } else if (this._messageHistory) {
      // Fall back to cached history for adapters without native message APIs
      this._recentMessages = await this._messageHistory.getMessages(
        this.id,
        50
      );
    } else {
      this._recentMessages = [];
    }
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
      channelVisibility: this.channelVisibility,
      currentMessage: this._currentMessage?.toJSON(),
      isDM: this.isDM,
      adapterName: this._adapterName ?? this.adapter.name,
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
    adapter?: Adapter
  ): ThreadImpl<TState> {
    const thread = new ThreadImpl<TState>({
      id: json.id,
      adapterName: json.adapterName,
      channelId: json.channelId,
      channelVisibility: json.channelVisibility,
      currentMessage: json.currentMessage
        ? Message.fromJSON(json.currentMessage)
        : undefined,
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
    threadIdOverride?: string
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
      links: [],
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
        newContent: string | PostableMessage | ChatElement
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
      links: message.links,
      isMention: message.isMention,

      toJSON() {
        return message.toJSON();
      },

      async edit(
        newContent: string | PostableMessage | ChatElement
      ): Promise<SentMessage> {
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
