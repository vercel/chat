import type { Root } from "mdast";
import { cardToFallbackText } from "./cards";
import { type CardJSXElement, isJSX, toCardElement } from "./jsx-runtime";
import {
  paragraph,
  parseMarkdown,
  root,
  text as textNode,
  toPlainText,
} from "./markdown";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Message,
  PostableMessage,
  SentMessage,
  StateAdapter,
  StreamOptions,
  Thread,
} from "./types";
import { THREAD_STATE_TTL_MS } from "./types";

interface ThreadImplConfig {
  id: string;
  adapter: Adapter;
  channelId: string;
  stateAdapter: StateAdapter;
  initialMessage?: Message;
  /** If true, thread is known to be subscribed (for short-circuit optimization) */
  isSubscribedContext?: boolean;
  /** Whether this is a direct message conversation */
  isDM?: boolean;
  /** Current message context for streaming (provides userId/teamId) */
  currentMessage?: Message;
  /** Update interval for fallback streaming in milliseconds. Defaults to 500ms. */
  streamingUpdateIntervalMs?: number;
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
  readonly adapter: Adapter;
  readonly channelId: string;
  readonly isDM: boolean;

  private _stateAdapter: StateAdapter;
  private _recentMessages: Message[] = [];
  private _isSubscribedContext: boolean;
  /** Current message context for streaming - provides userId/teamId */
  private _currentMessage?: Message;
  /** Update interval for fallback streaming */
  private _streamingUpdateIntervalMs: number;

  constructor(config: ThreadImplConfig) {
    this.id = config.id;
    this.adapter = config.adapter;
    this.channelId = config.channelId;
    this.isDM = config.isDM ?? false;
    this._stateAdapter = config.stateAdapter;
    this._isSubscribedContext = config.isSubscribedContext ?? false;
    this._currentMessage = config.currentMessage;
    this._streamingUpdateIntervalMs = config.streamingUpdateIntervalMs ?? 500;

    if (config.initialMessage) {
      this._recentMessages = [config.initialMessage];
    }
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

  get allMessages(): AsyncIterable<Message> {
    const adapter = this.adapter;
    const threadId = this.id;

    return {
      async *[Symbol.asyncIterator]() {
        let before: string | undefined;
        let hasMore = true;

        while (hasMore) {
          const messages = await adapter.fetchMessages(threadId, {
            limit: 100,
            before,
          });

          if (messages.length === 0) {
            hasMore = false;
            break;
          }

          for (const message of messages) {
            yield message;
          }

          before = messages[messages.length - 1]?.id;

          // If we got fewer than requested, we've reached the end
          if (messages.length < 100) {
            hasMore = false;
          }
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
    return this.createSentMessage(rawMessage.id, postable);
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
      return this.createSentMessage(raw.id, accumulated);
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
          await this.adapter.editMessage(this.id, msg.id, content);
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
      await this.adapter.editMessage(this.id, msg.id, accumulated);
    }

    return this.createSentMessage(msg.id, accumulated);
  }

  async refresh(): Promise<void> {
    const messages = await this.adapter.fetchMessages(this.id, { limit: 50 });
    this._recentMessages = messages;
  }

  mentionUser(userId: string): string {
    return `<@${userId}>`;
  }

  private createSentMessage(
    messageId: string,
    postable: AdapterPostableMessage,
  ): SentMessage {
    const adapter = this.adapter;
    const threadId = this.id;
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
