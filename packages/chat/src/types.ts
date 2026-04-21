/**
 * Core types for chat-sdk
 */

import type { Root } from "mdast";
import type { CardElement } from "./cards";
import type { SerializedChannel } from "./channel";
import type { ChatElement } from "./jsx-runtime";
import type { Logger, LogLevel } from "./logger";
import type { Message } from "./message";
import type { ModalElement, SelectOptionElement } from "./modals";
import type { PostableObject } from "./postable-object";
import type { SerializedThread } from "./thread";

// =============================================================================
// Channel Visibility
// =============================================================================

/**
 * Represents the visibility scope of a channel.
 *
 * - `private`: Channel is only visible to invited members (e.g., private Slack channels)
 * - `workspace`: Channel is visible to all workspace members (e.g., public Slack channels)
 * - `external`: Channel is shared with external organizations (e.g., Slack Connect)
 * - `unknown`: Visibility cannot be determined
 */
export type ChannelVisibility =
  | "private"
  | "workspace"
  | "external"
  | "unknown";

// =============================================================================
// Re-exports from extracted modules
// =============================================================================

export {
  ChatError,
  LockError,
  NotImplementedError,
  RateLimitError,
} from "./errors";
export type { Logger, LogLevel } from "./logger";
export { ConsoleLogger } from "./logger";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Chat configuration with type-safe adapter inference.
 * @template TAdapters - Record of adapter name to adapter instance
 */
export interface ChatConfig<
  TAdapters extends Record<string, Adapter> = Record<string, Adapter>,
> {
  /** Map of adapter name to adapter instance */
  adapters: TAdapters;
  /**
   * How to handle messages that arrive while a handler is already
   * processing on the same thread.
   *
   * - `'drop'` (default) — discard the message (throw `LockError`)
   * - `'queue'` — queue the message; when the current handler finishes,
   *   process only the latest queued message with `context.skipped` containing
   *   all intermediate messages
   * - `'debounce'` — all messages start/reset a debounce timer; only the
   *   final message in a burst is processed
   * - `'concurrent'` — no locking; all messages processed in parallel
   * - `ConcurrencyConfig` — fine-grained control over strategy and parameters
   */
  concurrency?: ConcurrencyStrategy | ConcurrencyConfig;
  /**
   * TTL for message deduplication entries in milliseconds.
   * Defaults to 300000 (5 minutes). Increase if your webhook cold starts
   * cause platform retries that arrive after the default TTL expires.
   */
  dedupeTtlMs?: number;
  /**
   * Placeholder text for fallback streaming (post + edit) adapters.
   * Defaults to `"..."`.
   *
   * Set to `null` to avoid posting an initial placeholder message and instead
   * wait until some real text has been streamed before creating the message.
   */
  fallbackStreamingPlaceholderText?: string | null;
  /**
   * Lock scope determines which messages contend for the same lock.
   *
   * - `'thread'`: lock per threadId (default for most adapters)
   * - `'channel'`: lock per channelId (default for WhatsApp, Telegram)
   * - function: resolve scope dynamically per message (async supported)
   *
   * When not set, falls back to the adapter's `lockScope` property,
   * then to `'thread'`.
   */
  lockScope?:
    | LockScope
    | ((context: LockScopeContext) => LockScope | Promise<LockScope>);
  /**
   * Logger instance or log level.
   * Pass "silent" to disable all logging.
   */
  logger?: Logger | LogLevel;
  /**
   * Configuration for persistent message history.
   * Only used by adapters that set `persistMessageHistory: true`.
   */
  messageHistory?: {
    /** Maximum messages to store per thread (default: 100) */
    maxMessages?: number;
    /** TTL for cached history in milliseconds (default: 7 days) */
    ttlMs?: number;
  };
  /**
   * @deprecated Use `concurrency` instead.
   *
   * Behavior when a thread lock cannot be acquired (another handler is processing).
   * - `'drop'` (default) — throw `LockError`, preserving current behavior
   * - `'force'` — force-release the existing lock and re-acquire
   * - callback — custom logic receiving `(threadId, message)`, return `'force'` or `'drop'`
   *
   * When `'force'` is used, the previous handler continues executing — only the lock
   * is released, not the handler itself. This means two handlers may run concurrently
   * on the same thread. The old handler's `releaseLock()` call becomes a no-op since
   * the token no longer matches.
   */
  onLockConflict?:
    | "force"
    | "drop"
    | ((
        threadId: string,
        message: Message
      ) => "force" | "drop" | Promise<"force" | "drop">);
  /** State adapter for subscriptions and locking */
  state: StateAdapter;
  /**
   * Update interval for fallback streaming (post + edit) in milliseconds.
   * Defaults to 500ms. Lower values provide smoother updates but may hit rate limits.
   */
  streamingUpdateIntervalMs?: number;
  /** Default bot username across all adapters */
  userName: string;
}

/**
 * Options for webhook handling.
 */
export interface WebhookOptions {
  /**
   * Override the default modal-opening behavior to handle it inline
   * within the current webhook response cycle.
   * When provided, called instead of adapter.openModal().
   * Used by Teams to return modal content in the HTTP invoke response.
   *
   * The returned `viewId` is platform-specific (e.g. Slack's view ID).
   * Adapters that don't produce a view ID may return void.
   */
  onOpenModal?: (
    modal: ModalElement,
    contextId: string
  ) => Promise<{ viewId: string } | undefined>;
  /**
   * Function to run message handling in the background.
   * Use this to ensure fast webhook responses while processing continues.
   *
   * @example
   * // Next.js App Router
   * import { after } from "next/server";
   * chat.webhooks.slack(request, { waitUntil: (p) => after(() => p) });
   *
   * @example
   * // Vercel Functions
   * import { waitUntil } from "@vercel/functions";
   * chat.webhooks.slack(request, { waitUntil });
   */
  waitUntil?: (task: Promise<unknown>) => void;
}

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * Adapter interface with generics for platform-specific types.
 * @template TThreadId - Platform-specific thread ID data type
 * @template TRawMessage - Platform-specific raw message type
 */
export interface Adapter<TThreadId = unknown, TRawMessage = unknown> {
  /** Add a reaction to a message */
  addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void>;
  /** Bot user ID for platforms that use IDs in mentions (e.g., Slack's <@U123>) */
  readonly botUserId?: string;

  /**
   * Derive channel ID from a thread ID.
   * Default fallback: first two colon-separated parts (e.g., "slack:C123").
   * Adapters with different structures should override this.
   */
  channelIdFromThreadId(threadId: string): string;

  /** Decode thread ID string back to platform-specific data */
  decodeThreadId(threadId: string): TThreadId;

  /** Delete a message */
  deleteMessage(threadId: string, messageId: string): Promise<void>;

  /** Cleanup hook called when Chat instance is shutdown */
  disconnect?(): Promise<void>;

  /** Edit an existing message */
  editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TRawMessage>>;

  /**
   * Edit a previously posted object (Plan, Poll, etc.).
   * If not implemented, object updates will throw PlanNotSupportedError.
   *
   * @param threadId - The thread containing the message
   * @param messageId - The message ID to edit
   * @param kind - The object kind (e.g., "plan")
   * @param data - The object data (type depends on kind)
   */
  editObject?(
    threadId: string,
    messageId: string,
    kind: string,
    data: unknown
  ): Promise<RawMessage<TRawMessage>>;

  /** Encode platform-specific data into a thread ID string */
  encodeThreadId(platformData: TThreadId): string;

  /**
   * Fetch channel info/metadata.
   */
  fetchChannelInfo?(channelId: string): Promise<ChannelInfo>;

  /**
   * Fetch channel-level messages (top-level, not thread replies).
   * For example, Slack's conversations.history vs conversations.replies.
   */
  fetchChannelMessages?(
    channelId: string,
    options?: FetchOptions
  ): Promise<FetchResult<TRawMessage>>;

  /**
   * Fetch a single message by ID.
   * Optional - adapters that don't implement this will return null.
   *
   * @param threadId - The thread ID containing the message
   * @param messageId - The platform-specific message ID
   * @returns The message, or null if not found/not supported
   */
  fetchMessage?(
    threadId: string,
    messageId: string
  ): Promise<Message<TRawMessage> | null>;

  /**
   * Fetch messages from a thread.
   *
   * **Direction behavior:**
   * - `backward` (default): Fetches the most recent messages. Use this for loading
   *   a chat view. The `nextCursor` points to older messages.
   * - `forward`: Fetches the oldest messages first. Use this for iterating through
   *   message history. The `nextCursor` points to newer messages.
   *
   * **Message ordering:**
   * Messages within each page are always returned in chronological order (oldest first),
   * regardless of direction. This is the natural reading order for chat messages.
   *
   * @example
   * ```typescript
   * // Load most recent 50 messages for display
   * const recent = await adapter.fetchMessages(threadId, { limit: 50 });
   * // recent.messages: [older, ..., newest] in chronological order
   *
   * // Paginate backward to load older messages
   * const older = await adapter.fetchMessages(threadId, {
   *   limit: 50,
   *   cursor: recent.nextCursor,
   * });
   *
   * // Iterate through all history from the beginning
   * const history = await adapter.fetchMessages(threadId, {
   *   limit: 100,
   *   direction: 'forward',
   * });
   * ```
   */
  fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<TRawMessage>>;

  /** Fetch thread metadata */
  fetchThread(threadId: string): Promise<ThreadInfo>;

  /**
   * Get the visibility scope of a channel containing the thread.
   *
   * This distinguishes between private channels, workspace-visible channels,
   * and externally shared channels (e.g., Slack Connect).
   *
   * @param threadId - The thread ID to check
   * @returns The channel visibility scope
   */
  getChannelVisibility?(threadId: string): ChannelVisibility;

  /** Handle incoming webhook request */
  handleWebhook(request: Request, options?: WebhookOptions): Promise<Response>;

  /** Called when Chat instance is created (internal use) */
  initialize(chat: ChatInstance): Promise<void>;

  /**
   * Check if a thread is a direct message conversation.
   *
   * @param threadId - The thread ID to check
   * @returns True if the thread is a DM, false otherwise
   */
  isDM?(threadId: string): boolean;

  /**
   * List threads in a channel.
   */
  listThreads?(
    channelId: string,
    options?: ListThreadsOptions
  ): Promise<ListThreadsResult<TRawMessage>>;

  /**
   * Default lock scope for this adapter.
   * - `'thread'` (default): lock per threadId
   * - `'channel'`: lock per channelId (for channel-based platforms like WhatsApp, Telegram)
   *
   * Can be overridden by `ChatConfig.lockScope`.
   */
  readonly lockScope?: LockScope;
  /** Unique name for this adapter (e.g., "slack", "teams") */
  readonly name: string;

  /**
   * Optional hook called when a thread is subscribed to.
   * Adapters can use this to set up platform-specific subscriptions
   * (e.g., Google Chat Workspace Events).
   */
  onThreadSubscribe?(threadId: string): Promise<void>;

  /**
   * Open a direct message conversation with a user.
   *
   * @param userId - The platform-specific user ID
   * @returns The thread ID for the DM conversation
   *
   * @example
   * ```typescript
   * const dmThreadId = await adapter.openDM("U123456");
   * await adapter.postMessage(dmThreadId, "Hello!");
   * ```
   */
  openDM?(userId: string): Promise<string>;

  /**
   * Open a modal/dialog form.
   *
   * @param triggerId - Platform-specific trigger ID from the action event
   * @param modal - The modal element to display
   * @param contextId - Optional context ID for server-side stored thread/message context
   * @returns The view/dialog ID
   */
  openModal?(
    triggerId: string,
    modal: ModalElement,
    contextId?: string
  ): Promise<{ viewId: string }>;

  /** Parse platform message format to normalized format */
  parseMessage(raw: TRawMessage): Message<TRawMessage>;

  /**
   * When true, the SDK persists message history in the state adapter for this platform.
   * Use this for platforms that lack server-side message history APIs (e.g., WhatsApp, Telegram).
   */
  readonly persistMessageHistory?: boolean;

  /**
   * Post a message to channel top-level (not in a thread).
   */
  postChannelMessage?(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TRawMessage>>;

  /**
   * Post an ephemeral message visible only to a specific user.
   *
   * This is optional - if not implemented, Thread.postEphemeral will
   * fall back to openDM + postMessage when fallbackToDM is true.
   *
   * @param threadId - The thread to post in
   * @param userId - The user who should see the message
   * @param message - The message content
   * @returns EphemeralMessage with usedFallback: false
   */
  postEphemeral?(
    threadId: string,
    userId: string,
    message: AdapterPostableMessage
  ): Promise<EphemeralMessage<TRawMessage>>;

  /** Post a message to a thread */
  postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TRawMessage>>;

  /**
   * Post a special object (Plan, Poll, etc.) as a single message.
   * If not implemented, posting such objects will throw PlanNotSupportedError.
   *
   * @param threadId - The thread to post to
   * @param kind - The object kind (e.g., "plan")
   * @param data - The object data (type depends on kind)
   */
  postObject?(
    threadId: string,
    kind: string,
    data: unknown
  ): Promise<RawMessage<TRawMessage>>;

  /**
   * Reconstruct fetchData on an attachment after deserialization.
   * Called during message rehydration for queue/debounce strategies.
   * Uses fetchMetadata and adapter auth context to rebuild the download closure.
   */
  rehydrateAttachment?(attachment: Attachment): Attachment;

  /** Remove a reaction from a message */
  removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void>;

  /** Render formatted content to platform-specific string */
  renderFormatted(content: FormattedContent): string;

  /**
   * Schedule a message for future delivery.
   *
   * Optional — only supported by adapters with native scheduling APIs (e.g., Slack).
   * Thread.schedule() will throw NotImplementedError if this method is absent.
   *
   * @param threadId - The thread to post in
   * @param message - The message content
   * @param options - Scheduling options including the target delivery time
   * @returns A ScheduledMessage with cancel() capability
   */
  scheduleMessage?(
    threadId: string,
    message: AdapterPostableMessage,
    options: { postAt: Date }
  ): Promise<ScheduledMessage<TRawMessage>>;

  /** Show typing indicator */
  startTyping(threadId: string, status?: string): Promise<void>;

  /**
   * Stream a message using platform-native streaming APIs.
   *
   * The adapter consumes the async iterable and handles the entire streaming lifecycle.
   * Only available on platforms with native streaming support (e.g., Slack).
   *
   * The stream can yield plain strings (text chunks) or {@link StreamChunk} objects
   * for rich content like task progress cards. Adapters that don't support structured
   * chunks will extract text from `markdown_text` chunks and ignore other types.
   *
   * @param threadId - The thread to stream to
   * @param textStream - Async iterable of text chunks or structured StreamChunk objects
   * @param options - Platform-specific streaming options
   * @returns The raw message after streaming completes
   */
  stream?(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<TRawMessage>>;
  /** Bot username (can override global userName) */
  readonly userName: string;
}

/**
 * A structured streaming chunk for platform-native rich content.
 *
 * On Slack, these map directly to streaming chunk types:
 * - `markdown_text`: Streamed text content
 * - `task_update`: Tool/step progress cards (pending → in_progress → complete → error)
 * - `plan_update`: Plan title updates
 *
 * Adapters that don't support structured chunks will extract `text` from
 * `markdown_text` chunks and ignore other types gracefully.
 */
export type StreamChunk = MarkdownTextChunk | TaskUpdateChunk | PlanUpdateChunk;

export interface MarkdownTextChunk {
  text: string;
  type: "markdown_text";
}

export interface TaskUpdateChunk {
  details?: string;
  id: string;
  output?: string;
  status: "pending" | "in_progress" | "complete" | "error";
  title: string;
  type: "task_update";
}

export interface PlanUpdateChunk {
  title: string;
  type: "plan_update";
}

/**
 * Options for streaming messages.
 * Platform-specific options are passed through to the adapter.
 */
export interface StreamOptions {
  /** Slack: The team/workspace ID */
  recipientTeamId?: string;
  /** Slack: The user ID to stream to (for AI assistant context) */
  recipientUserId?: string;
  /** Block Kit elements to attach when stopping the stream (Slack only, via chat.stopStream) */
  stopBlocks?: unknown[];
  /**
   * Slack: Controls how task_update chunks are displayed.
   * - `"timeline"` — individual task cards shown inline with text (default)
   * - `"plan"` — all tasks grouped into a single plan block
   */
  taskDisplayMode?: "timeline" | "plan";
  /** Minimum interval between updates in ms (default: 1000). Used for fallback mode (GChat/Teams). */
  updateIntervalMs?: number;
}

/** Internal interface for Chat instance passed to adapters */
export interface ChatInstance {
  /** Get the configured logger, optionally with a child prefix */
  getLogger(prefix?: string): Logger;

  getState(): StateAdapter;
  getUserName(): string;

  /**
   * @deprecated Use processMessage instead. This method is for internal use.
   */
  handleIncomingMessage(
    adapter: Adapter,
    threadId: string,
    message: Message
  ): Promise<void>;

  /**
   * Process an incoming action event (button click) from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param event - The action event (without thread field, will be added)
   * @param options - Webhook options including waitUntil
   */
  processAction(
    event: Omit<ActionEvent, "thread" | "openModal"> & { adapter: Adapter },
    options: WebhookOptions | undefined
  ): Promise<void>;

  processAppHomeOpened(
    event: AppHomeOpenedEvent,
    options?: WebhookOptions
  ): void;

  processAssistantContextChanged(
    event: AssistantContextChangedEvent,
    options?: WebhookOptions
  ): void;

  processAssistantThreadStarted(
    event: AssistantThreadStartedEvent,
    options?: WebhookOptions
  ): void;

  processMemberJoinedChannel(
    event: MemberJoinedChannelEvent,
    options?: WebhookOptions
  ): void;
  /**
   * Process an incoming message from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param adapter - The adapter that received the message
   * @param threadId - The thread ID
   * @param message - Either a parsed message, or a factory function for lazy async parsing
   * @param options - Webhook options including waitUntil
   */
  processMessage(
    adapter: Adapter,
    threadId: string,
    message: Message | (() => Promise<Message>),
    options?: WebhookOptions
  ): void;

  /**
   * Process a modal close event from an adapter.
   *
   * @param event - The modal close event (without relatedThread/relatedMessage/relatedChannel)
   * @param contextId - Context ID for retrieving stored thread/message/channel context
   * @param options - Webhook options
   */
  processModalClose(
    event: Omit<
      ModalCloseEvent,
      "relatedThread" | "relatedMessage" | "relatedChannel"
    >,
    contextId?: string,
    options?: WebhookOptions
  ): void;

  /**
   * Process a modal submit event from an adapter.
   *
   * @param event - The modal submit event (without relatedThread/relatedMessage/relatedChannel)
   * @param contextId - Context ID for retrieving stored thread/message/channel context
   * @param options - Webhook options
   */
  processModalSubmit(
    event: Omit<
      ModalSubmitEvent,
      "relatedThread" | "relatedMessage" | "relatedChannel"
    >,
    contextId?: string,
    options?: WebhookOptions
  ): Promise<ModalResponse | undefined>;

  /**
   * Process an interactive options load event from an adapter.
   * Returns normalized select options for the adapter to render.
   */
  processOptionsLoad(
    event: OptionsLoadEvent,
    options?: WebhookOptions
  ): Promise<SelectOptionElement[] | undefined>;

  /**
   * Process an incoming reaction event from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param event - The reaction event (without adapter field, will be added)
   * @param options - Webhook options including waitUntil
   */
  processReaction(
    event: Omit<ReactionEvent, "adapter" | "thread"> & { adapter?: Adapter },
    options?: WebhookOptions
  ): void;

  /**
   * Process an incoming slash command from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param event - The slash command event
   * @param options - Webhook options including waitUntil
   */
  processSlashCommand(
    event: Omit<SlashCommandEvent, "channel" | "openModal"> & {
      adapter: Adapter;
      channelId: string;
    },
    options: WebhookOptions | undefined
  ): void;
}

// =============================================================================
// Concurrency
// =============================================================================

/** Lock scope determines which messages contend for the same lock. */
export type LockScope = "thread" | "channel";

/** Context provided to the lockScope resolver function. */
export interface LockScopeContext {
  adapter: Adapter;
  channelId: string;
  isDM: boolean;
  threadId: string;
}

/** Concurrency strategy for overlapping messages on the same thread. */
export type ConcurrencyStrategy = "drop" | "queue" | "debounce" | "concurrent";

/** Fine-grained concurrency configuration. */
export interface ConcurrencyConfig {
  /** Debounce window in milliseconds (debounce strategy). Default: 1500. */
  debounceMs?: number;
  /** Max concurrent handlers per thread (concurrent strategy). Default: Infinity. */
  maxConcurrent?: number;
  /** Max queued messages per thread (queue/debounce strategy). Default: 10. */
  maxQueueSize?: number;
  /** What to do when queue is full. Default: 'drop-oldest'. */
  onQueueFull?: "drop-oldest" | "drop-newest";
  /** TTL for queued entries in milliseconds. Default: 90000 (90s). */
  queueEntryTtlMs?: number;
  /** The concurrency strategy to use. */
  strategy: ConcurrencyStrategy;
}

/**
 * An entry in the per-thread message queue.
 * Used by the `queue` and `debounce` concurrency strategies.
 */
export interface QueueEntry {
  /** When this entry was enqueued (Unix ms). */
  enqueuedAt: number;
  /** When this entry expires (Unix ms). Stale entries are discarded on dequeue. */
  expiresAt: number;
  /** The queued message. */
  message: Message;
}

/**
 * Context provided to message handlers when messages were queued
 * while a previous handler was running.
 */
export interface MessageContext {
  /**
   * Messages that arrived while the previous handler was running,
   * in chronological order, excluding the current message (which is the latest).
   */
  skipped: Message[];
  /** Total messages received since last handler ran (skipped.length + 1). */
  totalSinceLastHandler: number;
}

// =============================================================================
// State Adapter Interface
// =============================================================================

export interface StateAdapter {
  /** Acquire a lock on a thread (returns null if already locked) */
  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null>;

  /** Atomically append a value to a list. Trims to maxLength (keeping newest). Refreshes TTL. */
  appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void>;

  /** Connect to the state backend */
  connect(): Promise<void>;

  /** Delete a cached value */
  delete(key: string): Promise<void>;

  /** Pop the next message from the thread's queue. Returns null if empty. */
  dequeue(threadId: string): Promise<QueueEntry | null>;

  /** Disconnect from the state backend */
  disconnect(): Promise<void>;

  /** Atomically append a message to the thread's pending queue. Returns new queue depth. */
  enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number>;

  /** Extend a lock's TTL */
  extendLock(lock: Lock, ttlMs: number): Promise<boolean>;

  /**
   * Force-release a lock on a thread, regardless of ownership token.
   * The previous lock holder's handler continues running — only the lock is released.
   * The old handler's `releaseLock()` becomes a no-op (token mismatch).
   */
  forceReleaseLock(threadId: string): Promise<void>;

  /** Get a cached value by key */
  get<T = unknown>(key: string): Promise<T | null>;

  /** Read all values from a list in insertion order. Returns empty array if key does not exist. */
  getList<T = unknown>(key: string): Promise<T[]>;

  /** Check if subscribed to a thread */
  isSubscribed(threadId: string): Promise<boolean>;

  /** Get the current queue depth for a thread. */
  queueDepth(threadId: string): Promise<number>;

  /** Release a lock */
  releaseLock(lock: Lock): Promise<void>;

  /** Set a cached value with optional TTL in milliseconds */
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;

  /** Atomically set a value only if the key does not already exist. Returns true if set, false if key existed. */
  setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean>;

  /** Subscribe to a thread (persists across restarts) */
  subscribe(threadId: string): Promise<void>;

  /** Unsubscribe from a thread */
  unsubscribe(threadId: string): Promise<void>;
}

export interface Lock {
  expiresAt: number;
  threadId: string;
  token: string;
}

// =============================================================================
// Postable (base interface for Thread and Channel)
// =============================================================================

/**
 * Base interface for entities that can receive messages.
 * Both Thread and Channel extend this interface.
 *
 * @template TState - Custom state type stored per entity
 * @template TRawMessage - Platform-specific raw message type
 */
export interface Postable<
  TState = Record<string, unknown>,
  TRawMessage = unknown,
> {
  /** The adapter this entity belongs to */
  readonly adapter: Adapter;
  /** The visibility scope of this channel */
  readonly channelVisibility: ChannelVisibility;
  /** Unique ID */
  readonly id: string;
  /** Whether this is a direct message conversation */
  readonly isDM: boolean;

  /**
   * Get a platform-specific mention string for a user.
   */
  mentionUser(userId: string): string;

  /**
   * Iterate messages newest first (backward from most recent).
   * Auto-paginates lazily — only fetches pages as consumed.
   */
  readonly messages: AsyncIterable<Message<TRawMessage>>;

  /**
   * Post a message.
   */
  post<T extends PostableObject>(message: T): Promise<T>;
  post(
    message: string | PostableMessage | ChatElement
  ): Promise<SentMessage<TRawMessage>>;

  /**
   * Post an ephemeral message visible only to a specific user.
   */
  postEphemeral(
    user: string | Author,
    message: AdapterPostableMessage | ChatElement,
    options: PostEphemeralOptions
  ): Promise<EphemeralMessage<TRawMessage> | null>;

  /**
   * Schedule a message for future delivery.
   *
   * Currently only supported by the Slack adapter. Other adapters
   * will throw NotImplementedError.
   *
   * @param message - The message content (streaming not supported)
   * @param options - Scheduling options including the target delivery time
   * @returns A ScheduledMessage with cancel() capability
   *
   * @example
   * ```typescript
   * const scheduled = await thread.schedule("Reminder: standup!", {
   *   postAt: new Date("2026-03-09T09:00:00Z"),
   * });
   *
   * // Cancel before it's sent
   * await scheduled.cancel();
   * ```
   */
  schedule(
    message: AdapterPostableMessage | ChatElement,
    options: { postAt: Date }
  ): Promise<ScheduledMessage<TRawMessage>>;

  /**
   * Set the state. Merges with existing state by default.
   */
  setState(
    state: Partial<TState>,
    options?: { replace?: boolean }
  ): Promise<void>;

  /** Show typing indicator */
  startTyping(status?: string): Promise<void>;

  /**
   * Get the current state.
   * Returns null if no state has been set.
   */
  readonly state: Promise<TState | null>;
}

// =============================================================================
// Channel
// =============================================================================

/**
 * Represents a channel/conversation container that holds threads.
 * Extends Postable for message posting capabilities.
 *
 * @template TState - Custom state type stored per channel
 * @template TRawMessage - Platform-specific raw message type
 */
export interface Channel<
  TState = Record<string, unknown>,
  TRawMessage = unknown,
> extends Postable<TState, TRawMessage> {
  /** Fetch channel metadata from the platform */
  fetchMetadata(): Promise<ChannelInfo>;
  /** Channel name (e.g., "#general"). Null until fetchInfo() is called. */
  readonly name: string | null;

  /**
   * Iterate threads in this channel, most recently active first.
   * Returns ThreadSummary (lightweight) for efficiency.
   * Empty iterable on threadless platforms.
   */
  threads(): AsyncIterable<ThreadSummary<TRawMessage>>;

  /**
   * Serialize the channel to a plain JSON object.
   * Use this to pass channel data to external systems like workflow engines.
   */
  toJSON(): SerializedChannel;
}

/**
 * Lightweight summary of a thread within a channel.
 */
export interface ThreadSummary<TRawMessage = unknown> {
  /** Full thread ID */
  id: string;
  /** Timestamp of most recent reply */
  lastReplyAt?: Date;
  /** Reply count (if available) */
  replyCount?: number;
  /** Root/first message of the thread */
  rootMessage: Message<TRawMessage>;
}

/**
 * Channel metadata returned by fetchInfo().
 */
export interface ChannelInfo {
  /** The visibility scope of this channel */
  channelVisibility?: ChannelVisibility;
  id: string;
  isDM?: boolean;
  memberCount?: number;
  metadata: Record<string, unknown>;
  name?: string;
}

/**
 * Options for listing threads in a channel.
 */
export interface ListThreadsOptions {
  cursor?: string;
  limit?: number;
}

/**
 * Result of listing threads in a channel.
 */
export interface ListThreadsResult<TRawMessage = unknown> {
  nextCursor?: string;
  threads: ThreadSummary<TRawMessage>[];
}

// =============================================================================
// Thread
// =============================================================================

/** Default TTL for thread state (30 days in milliseconds) */
export const THREAD_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Thread interface with support for custom state.
 * Extends Postable for shared message posting capabilities.
 *
 * @template TState - Custom state type stored per-thread (default: Record<string, unknown>)
 * @template TRawMessage - Platform-specific raw message type
 */
export interface Thread<TState = Record<string, unknown>, TRawMessage = unknown>
  extends Postable<TState, TRawMessage> {
  /**
   * Async iterator for all messages in the thread.
   * Messages are yielded in chronological order (oldest first).
   * Automatically handles pagination.
   */
  allMessages: AsyncIterable<Message<TRawMessage>>;

  /** Get the Channel containing this thread */
  readonly channel: Channel<TState, TRawMessage>;
  // Inherited from Postable: id, adapter, isDM, state, setState,
  //   messages (newest first), post, postEphemeral, startTyping, mentionUser

  /** Channel/conversation ID */
  readonly channelId: string;

  /**
   * Wrap a Message object as a SentMessage with edit/delete capabilities.
   * Used internally for reconstructing messages from serialized data.
   */
  createSentMessageFromMessage(
    message: Message<TRawMessage>
  ): SentMessage<TRawMessage>;

  /**
   * Get the unique human participants in this thread.
   *
   * Scans all messages in the thread and returns deduplicated authors,
   * excluding the bot itself. Useful for deciding whether to subscribe
   * based on how many humans are participating — subscribe when it's a
   * 1:1 conversation, unsubscribe when others join so humans can talk
   * without the bot replying to every message.
   *
   * @returns Array of unique non-bot authors
   *
   * @example
   * ```typescript
   * // Subscribe only when one person is talking to the bot
   * bot.onNewMention(async (thread, message) => {
   *   const participants = await thread.getParticipants();
   *   if (participants.length === 1) {
   *     await thread.subscribe();
   *     await thread.post("I'm here to help!");
   *   }
   * });
   *
   * // Unsubscribe when the thread becomes a group conversation
   * bot.onSubscribedMessage(async (thread, message) => {
   *   const participants = await thread.getParticipants();
   *   if (participants.length > 1) {
   *     await thread.unsubscribe();
   *     return;
   *   }
   *   await thread.post("Still here to help!");
   * });
   * ```
   */
  getParticipants(): Promise<Author[]>;

  /**
   * Check if this thread is currently subscribed.
   *
   * In subscribed message handlers, this is optimized to return true immediately
   * without a state lookup, since we already know we're in a subscribed context.
   *
   * @returns Promise resolving to true if subscribed, false otherwise
   */
  isSubscribed(): Promise<boolean>;

  /**
   * Get a platform-specific mention string for a user.
   * Use this to @-mention a user in a message.
   * @example
   * await thread.post(`Hey ${thread.mentionUser(userId)}, check this out!`);
   */
  mentionUser(userId: string): string;

  /**
   * Post a message to this thread.
   *
   * Supports text, markdown, cards, and streaming from async iterables.
   * When posting a stream (e.g., from AI SDK), uses platform-native streaming
   * APIs when available (Slack), or falls back to post + edit with throttling.
   *
   * @param message - String, PostableMessage, JSX Card, or AsyncIterable<string>
   * @returns A SentMessage with methods to edit, delete, or add reactions
   *
   * @example
   * ```typescript
   * // Simple string
   * await thread.post("Hello!");
   *
   * // Markdown
   * await thread.post({ markdown: "**Bold** and _italic_" });
   *
   * // With emoji
   * await thread.post(`${emoji.thumbs_up} Great job!`);
   *
   * // JSX Card (with @jsxImportSource chat)
   * await thread.post(
   *   <Card title="Welcome!">
   *     <Text>Hello world</Text>
   *   </Card>
   * );
   *
   * // Stream from AI SDK
   * const result = await agent.stream({ prompt: message.text });
   * await thread.post(result.textStream);
   *
   * // Stream with options via StreamingPlan PostableObject
   * const stream = new StreamingPlan(result.fullStream, {
   *   groupTasks: "plan",
   *   endWith: [feedbackBlocks],
   * });
   * await thread.post(stream);
   *
   * // Plan with live updates
   * const plan = new Plan({ initialMessage: "Working..." });
   * await thread.post(plan);
   * await plan.addTask({ title: "Step 1" });
   * await plan.complete({ completeMessage: "Done!" });
   * ```
   */
  post<T extends PostableObject>(message: T): Promise<T>;
  post(
    message: string | PostableMessage | ChatElement
  ): Promise<SentMessage<TRawMessage>>;

  /**
   * Post an ephemeral message visible only to a specific user.
   *
   * **Platform Behavior:**
   * - **Slack**: Native ephemeral (session-dependent, disappears on reload)
   * - **Google Chat**: Native private message (persists, only target user sees it)
   * - **Discord**: No native support - requires fallbackToDM: true
   * - **Teams**: No native support - requires fallbackToDM: true
   *
   * @param user - User ID string or Author object (from message.author or event.user)
   * @param message - Message content (string, markdown, card, etc.). Streaming is not supported.
   * @param options.fallbackToDM - Required. If true, falls back to DM when native
   *   ephemeral is not supported. If false, returns null when unsupported.
   * @returns EphemeralMessage with `usedFallback: true` if DM was used, or null
   *   if native ephemeral not supported and fallbackToDM is false
   *
   * @example
   * ```typescript
   * // Always send (DM fallback on Discord/Teams)
   * await thread.postEphemeral(user, 'Only you can see this!', { fallbackToDM: true })
   *
   * // Only send if native ephemeral supported (Slack/GChat)
   * const result = await thread.postEphemeral(user, 'Secret!', { fallbackToDM: false })
   * if (!result) {
   *   // Platform doesn't support native ephemeral - handle accordingly
   * }
   * ```
   */
  postEphemeral(
    user: string | Author,
    message: AdapterPostableMessage | ChatElement,
    options: PostEphemeralOptions
  ): Promise<EphemeralMessage<TRawMessage> | null>;

  /** Recently fetched messages (cached) */
  recentMessages: Message<TRawMessage>[];

  /**
   * Refresh `recentMessages` from the API.
   *
   * Fetches the latest 50 messages and updates `recentMessages`.
   */
  refresh(): Promise<void>;

  /**
   * Show typing indicator in the thread.
   *
   * Some platforms support persistent typing indicators, others just send once.
   * Optional status (e.g. "Typing...", "Searching documents...") is shown where supported.
   */
  startTyping(status?: string): Promise<void>;

  /**
   * Subscribe to future messages in this thread.
   *
   * Once subscribed, all messages in this thread will trigger `onSubscribedMessage` handlers.
   * The initial message that triggered subscription will NOT fire the handler.
   *
   * @example
   * ```typescript
   * chat.onNewMention(async (thread, message) => {
   *   await thread.subscribe();  // Subscribe to follow-up messages
   *   await thread.post("I'm now watching this thread!");
   * });
   * ```
   */
  subscribe(): Promise<void>;

  /**
   * Serialize the thread to a plain JSON object.
   * Use this to pass thread data to external systems like workflow engines.
   */
  toJSON(): SerializedThread;

  /**
   * Unsubscribe from this thread.
   *
   * Future messages will no longer trigger `onSubscribedMessage` handlers.
   */
  unsubscribe(): Promise<void>;
}

// =============================================================================
// Postable Objects
// =============================================================================

// Re-export Plan types from plan.ts for backwards compatibility
export type {
  AddTaskOptions,
  CompletePlanOptions,
  PlanContent,
  PlanModel,
  PlanModelTask,
  PlanTask,
  PlanTaskStatus,
  StartPlanOptions,
  UpdateTaskInput,
} from "./plan";
// Re-export PostableObject types from plan.ts for backwards compatibility
export type { PostableObject, PostableObjectContext } from "./postable-object";

export interface ThreadInfo {
  channelId: string;
  channelName?: string;
  /** The visibility scope of this channel */
  channelVisibility?: ChannelVisibility;
  id: string;
  /** Whether this is a direct message conversation */
  isDM?: boolean;
  /** Platform-specific metadata */
  metadata: Record<string, unknown>;
}

/**
 * Direction for fetching messages.
 *
 * - `backward`: Fetch most recent messages first. Pagination moves toward older messages.
 *   This is the default, suitable for loading a chat view (show latest messages first).
 *
 * - `forward`: Fetch oldest messages first. Pagination moves toward newer messages.
 *   Suitable for iterating through message history from the beginning.
 *
 * In both directions, messages within each page are returned in chronological order
 * (oldest first), which is the natural reading order for chat messages.
 *
 * @example
 * ```typescript
 * // Load most recent 50 messages (default)
 * const recent = await adapter.fetchMessages(threadId, { limit: 50 });
 * // recent.messages: [older, ..., newest] (chronological within page)
 * // recent.nextCursor: points to older messages
 *
 * // Iterate through all history from beginning
 * const history = await adapter.fetchMessages(threadId, {
 *   limit: 50,
 *   direction: 'forward',
 * });
 * // history.messages: [oldest, ..., newer] (chronological within page)
 * // history.nextCursor: points to even newer messages
 * ```
 */
export type FetchDirection = "forward" | "backward";

/**
 * Options for fetching messages from a thread.
 */
export interface FetchOptions {
  /**
   * Pagination cursor for fetching the next page of messages.
   * Pass the `nextCursor` from a previous `FetchResult`.
   */
  cursor?: string;
  /**
   * Direction to fetch messages.
   *
   * - `backward` (default): Fetch most recent messages. Cursor moves to older messages.
   * - `forward`: Fetch oldest messages. Cursor moves to newer messages.
   *
   * Messages within each page are always returned in chronological order (oldest first).
   */
  direction?: FetchDirection;
  /** Maximum number of messages to fetch. Default varies by adapter (50-100). */
  limit?: number;
}

/**
 * Result of fetching messages from a thread.
 */
export interface FetchResult<TRawMessage = unknown> {
  /**
   * Messages in chronological order (oldest first within this page).
   *
   * For `direction: 'backward'` (default): These are the N most recent messages.
   * For `direction: 'forward'`: These are the N oldest messages (or next N after cursor).
   */
  messages: Message<TRawMessage>[];
  /**
   * Cursor for fetching the next page.
   * Pass this as `cursor` in the next `fetchMessages` call.
   *
   * - For `direction: 'backward'`: Points to older messages.
   * - For `direction: 'forward'`: Points to newer messages.
   *
   * Undefined if there are no more messages in that direction.
   */
  nextCursor?: string;
}

// =============================================================================
// Message
// =============================================================================

/**
 * Formatted content using mdast AST.
 * This is the canonical representation of message formatting.
 */
export type FormattedContent = Root;

/** Raw message returned from adapter (before wrapping as SentMessage) */
export interface RawMessage<TRawMessage = unknown> {
  id: string;
  raw: TRawMessage;
  threadId: string;
}

export interface Author {
  /** Display name */
  fullName: string;
  /** Whether the author is a bot */
  isBot: boolean | "unknown";
  /** Whether the author is this bot */
  isMe: boolean;
  /** Unique user ID */
  userId: string;
  /** Username/handle for @-mentions */
  userName: string;
}

export interface MessageMetadata {
  /** When the message was sent */
  dateSent: Date;
  /** Whether the message has been edited */
  edited: boolean;
  /** When the message was last edited */
  editedAt?: Date;
}

// =============================================================================
// Sent Message (returned from thread.post())
// =============================================================================

export interface SentMessage<TRawMessage = unknown>
  extends Message<TRawMessage> {
  /** Add a reaction to this message */
  addReaction(emoji: EmojiValue | string): Promise<void>;
  /** Delete this message */
  delete(): Promise<void>;
  /** Edit this message with text, a PostableMessage, or a JSX Card element */
  edit(
    newContent: string | PostableMessage | ChatElement
  ): Promise<SentMessage<TRawMessage>>;
  /** Remove a reaction from this message */
  removeReaction(emoji: EmojiValue | string): Promise<void>;
}

// =============================================================================
// Ephemeral Message (returned from thread.postEphemeral())
// =============================================================================

/**
 * Result of posting an ephemeral message.
 *
 * Ephemeral messages are visible only to a specific user and typically
 * cannot be edited or deleted (platform-dependent).
 */
export interface EphemeralMessage<TRawMessage = unknown> {
  /** Message ID (may be empty for some platforms) */
  id: string;
  /** Platform-specific raw response */
  raw: TRawMessage;
  /** Thread ID where message was sent (or DM thread if fallback was used) */
  threadId: string;
  /** Whether this used native ephemeral or fell back to DM */
  usedFallback: boolean;
}

/**
 * Options for posting ephemeral messages.
 */
export interface PostEphemeralOptions {
  /**
   * Controls behavior when native ephemeral is not supported by the platform.
   *
   * - `true`: Falls back to sending a DM to the user
   * - `false`: Returns `null` if native ephemeral is not supported
   */
  fallbackToDM: boolean;
}

// =============================================================================
// Scheduled Message (returned from thread.schedule())
// =============================================================================

/**
 * Result of scheduling a message for future delivery.
 *
 * Currently only supported by the Slack adapter via `chat.scheduleMessage`.
 * Other adapters will throw `NotImplementedError` when `schedule()` is called.
 */
export interface ScheduledMessage<TRawMessage = unknown> {
  /** Cancel the scheduled message before it's sent */
  cancel(): Promise<void>;
  /** Channel ID where the message will be posted */
  channelId: string;
  /** When the message will be sent */
  postAt: Date;
  /** Platform-specific raw response */
  raw: TRawMessage;
  /** Platform-specific scheduled message ID */
  scheduledMessageId: string;
}

// =============================================================================
// Postable Message
// =============================================================================

/**
 * Input type for adapter postMessage/editMessage methods.
 * This excludes streams since adapters handle content synchronously.
 */
export type AdapterPostableMessage =
  | string
  | PostableRaw
  | PostableMarkdown
  | PostableAst
  | PostableCard
  | CardElement;

/**
 * A message that can be posted to a thread.
 *
 * - `string` - Raw text, passed through as-is to the platform
 * - `{ raw: string }` - Explicit raw text, passed through as-is
 * - `{ markdown: string }` - Markdown text, converted to platform format
 * - `{ ast: Root }` - mdast AST, converted to platform format
 * - `{ card: CardElement }` - Rich card with buttons (Block Kit / Adaptive Cards / GChat Cards)
 * - `CardElement` - Direct card element
 * - `AsyncIterable<string>` - Streaming text (e.g., from AI SDK's textStream)
 * - `AsyncIterable<string | StreamEvent>` - AI SDK fullStream (auto-detected, extracts text with step separators)
 */
export type PostableMessage =
  | AdapterPostableMessage
  | AsyncIterable<string | StreamChunk | StreamEvent>
  | PostableObject;

/**
 * Duck-typed stream event compatible with AI SDK's `fullStream`.
 * - `text-delta` events are extracted as text output.
 * - `step-finish` events trigger paragraph separators between steps.
 * - All other event types (tool-call, tool-result, etc.) are silently skipped.
 */
export type StreamEvent =
  | { textDelta: string; type: "text-delta" }
  | { type: "step-finish" }
  | { type: string };

export interface PostableRaw {
  /** File/image attachments */
  attachments?: Attachment[];
  /** Files to upload */
  files?: FileUpload[];
  /** Raw text passed through as-is to the platform */
  raw: string;
}

export interface PostableMarkdown {
  /** File/image attachments */
  attachments?: Attachment[];
  /** Files to upload */
  files?: FileUpload[];
  /** Markdown text, converted to platform format */
  markdown: string;
}

export interface PostableAst {
  /** mdast AST, converted to platform format */
  ast: Root;
  /** File/image attachments */
  attachments?: Attachment[];
  /** Files to upload */
  files?: FileUpload[];
}

export interface PostableCard {
  /** Rich card element */
  card: CardElement;
  /** Fallback text for platforms/clients that can't render cards */
  fallbackText?: string;
  /** Files to upload */
  files?: FileUpload[];
}

export interface Attachment {
  /** Binary data (for uploading or if already fetched) */
  data?: Buffer | Blob;
  /**
   * Fetch the attachment data.
   * For platforms that require authentication (like Slack private URLs),
   * this method handles the auth automatically.
   */
  fetchData?: () => Promise<Buffer>;
  /**
   * Platform-specific metadata needed to reconstruct fetchData after serialization.
   * Adapters store IDs here (e.g. WhatsApp mediaId, Telegram fileId) so that
   * fetchData can be rebuilt when a message is rehydrated from the queue.
   */
  fetchMetadata?: Record<string, string>;
  /** Image/video height (if applicable) */
  height?: number;
  /** MIME type */
  mimeType?: string;
  /** Filename */
  name?: string;
  /** File size in bytes */
  size?: number;
  /** Type of attachment */
  type: "image" | "file" | "video" | "audio";
  /** URL to the file (for linking/downloading) */
  url?: string;
  /** Image/video width (if applicable) */
  width?: number;
}

/**
 * A link found in a message, with optional unfurl metadata.
 *
 * On the initial message event, only `url` is available (unfurl metadata
 * arrives later via `message_changed`). The `fetchMessage` callback is
 * provided when the URL points to another chat message on the same platform.
 */
export interface LinkPreview {
  /** Description from unfurl metadata (if available) */
  description?: string;
  /** If this links to a chat message, fetch the full Message */
  fetchMessage?: () => Promise<Message>;
  /** Preview image URL (if available) */
  imageUrl?: string;
  /** Site name (e.g., "Vercel") */
  siteName?: string;
  /** Title from unfurl metadata (if available) */
  title?: string;
  /** The URL */
  url: string;
}

/**
 * File to upload with a message.
 */
export interface FileUpload {
  /** Binary data */
  data: Buffer | Blob | ArrayBuffer;
  /** Filename */
  filename: string;
  /** MIME type (optional, will be inferred from filename if not provided) */
  mimeType?: string;
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handler for new @-mentions of the bot.
 *
 * **Important**: This handler is ONLY called for mentions in **unsubscribed** threads.
 * Once a thread is subscribed (via `thread.subscribe()`), subsequent messages
 * including @-mentions go to `onSubscribedMessage` handlers instead.
 *
 * To detect mentions in subscribed threads, check `message.isMention`:
 *
 * @example
 * ```typescript
 * // Handle new mentions (unsubscribed threads only)
 * chat.onNewMention(async (thread, message) => {
 *   await thread.subscribe();  // Subscribe to follow-up messages
 *   await thread.post("Hello! I'll be watching this thread.");
 * });
 *
 * // Handle all messages in subscribed threads
 * chat.onSubscribedMessage(async (thread, message) => {
 *   if (message.isMention) {
 *     // User @-mentioned us in a thread we're already watching
 *     await thread.post("You mentioned me again!");
 *   }
 * });
 * ```
 */
export type MentionHandler<TState = Record<string, unknown>> = (
  thread: Thread<TState>,
  message: Message,
  context?: MessageContext
) => void | Promise<void>;

/**
 * Handler for direct messages (1:1 conversations with the bot).
 *
 * Registered via `chat.onDirectMessage(handler)`. Called when a message
 * is received in a DM thread that is not subscribed. If no `onDirectMessage`
 * handlers are registered, DMs fall through to `onNewMention` for backward
 * compatibility.
 */
export type DirectMessageHandler<TState = Record<string, unknown>> = (
  thread: Thread<TState>,
  message: Message,
  channel: Channel<TState>,
  context?: MessageContext
) => void | Promise<void>;

/**
 * Handler for messages matching a regex pattern.
 *
 * Registered via `chat.onNewMessage(pattern, handler)`. Called when a message
 * matches the pattern in an unsubscribed thread.
 */
export type MessageHandler<TState = Record<string, unknown>> = (
  thread: Thread<TState>,
  message: Message,
  context?: MessageContext
) => void | Promise<void>;

/**
 * Handler for messages in subscribed threads.
 *
 * Called for all messages in threads that have been subscribed via `thread.subscribe()`.
 * This includes:
 * - Follow-up messages from users
 * - Messages that @-mention the bot (check `message.isMention`)
 *
 * Does NOT fire for:
 * - The message that triggered the subscription (e.g., the initial @mention)
 * - Messages sent by the bot itself
 *
 * @example
 * ```typescript
 * chat.onSubscribedMessage(async (thread, message) => {
 *   // Handle all follow-up messages
 *   if (message.isMention) {
 *     // User @-mentioned us in a subscribed thread
 *   }
 *   await thread.post(`Got your message: ${message.text}`);
 * });
 * ```
 */
export type SubscribedMessageHandler<TState = Record<string, unknown>> = (
  thread: Thread<TState>,
  message: Message,
  context?: MessageContext
) => void | Promise<void>;

// =============================================================================
// Reactions / Emoji
// =============================================================================

/**
 * Well-known emoji that work across platforms (Slack and Google Chat).
 * These are normalized to a common format regardless of platform.
 */
export type WellKnownEmoji =
  // Reactions & Gestures
  | "thumbs_up"
  | "thumbs_down"
  | "clap"
  | "wave"
  | "pray"
  | "muscle"
  | "ok_hand"
  | "point_up"
  | "point_down"
  | "point_left"
  | "point_right"
  | "raised_hands"
  | "shrug"
  | "facepalm"
  // Emotions & Faces
  | "heart"
  | "smile"
  | "laugh"
  | "thinking"
  | "sad"
  | "cry"
  | "angry"
  | "love_eyes"
  | "cool"
  | "wink"
  | "surprised"
  | "worried"
  | "confused"
  | "neutral"
  | "sleeping"
  | "sick"
  | "mind_blown"
  | "relieved"
  | "grimace"
  | "rolling_eyes"
  | "hug"
  | "zany"
  // Status & Symbols
  | "check"
  | "x"
  | "question"
  | "exclamation"
  | "warning"
  | "stop"
  | "info"
  | "100"
  | "fire"
  | "star"
  | "sparkles"
  | "lightning"
  | "boom"
  | "eyes"
  // Status Indicators
  | "green_circle"
  | "yellow_circle"
  | "red_circle"
  | "blue_circle"
  | "white_circle"
  | "black_circle"
  // Objects & Tools
  | "rocket"
  | "party"
  | "confetti"
  | "balloon"
  | "gift"
  | "trophy"
  | "medal"
  | "lightbulb"
  | "gear"
  | "wrench"
  | "hammer"
  | "bug"
  | "link"
  | "lock"
  | "unlock"
  | "key"
  | "pin"
  | "memo"
  | "clipboard"
  | "calendar"
  | "clock"
  | "hourglass"
  | "bell"
  | "megaphone"
  | "speech_bubble"
  | "email"
  | "inbox"
  | "outbox"
  | "package"
  | "folder"
  | "file"
  | "chart_up"
  | "chart_down"
  | "coffee"
  | "pizza"
  | "beer"
  // Arrows & Directions
  | "arrow_up"
  | "arrow_down"
  | "arrow_left"
  | "arrow_right"
  | "refresh"
  // Nature & Weather
  | "sun"
  | "cloud"
  | "rain"
  | "snow"
  | "rainbow";

/**
 * Platform-specific emoji formats for a single emoji.
 */
export interface EmojiFormats {
  /** Google Chat unicode emoji, e.g., "👍", "❤️" */
  gchat: string | string[];
  /** Slack emoji name (without colons), e.g., "+1", "heart" */
  slack: string | string[];
}

/**
 * Emoji map type - can be extended by users to add custom emoji.
 *
 * @example
 * ```typescript
 * // Extend with custom emoji
 * declare module "chat" {
 *   interface CustomEmojiMap {
 *     "custom_emoji": EmojiFormats;
 *   }
 * }
 *
 * const myEmojiMap: EmojiMapConfig = {
 *   custom_emoji: { slack: "custom", gchat: "🎯" },
 * };
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Required for TypeScript module augmentation
export interface CustomEmojiMap {}

/**
 * Full emoji type including well-known and custom emoji.
 */
export type Emoji = WellKnownEmoji | keyof CustomEmojiMap;

/**
 * Configuration for emoji mapping.
 */
export type EmojiMapConfig = Partial<Record<Emoji, EmojiFormats>>;

/**
 * Immutable emoji value object with object identity.
 *
 * These objects are singletons - the same emoji name always returns
 * the same frozen object instance, enabling `===` comparison.
 *
 * @example
 * ```typescript
 * // Object identity comparison works
 * if (event.emoji === emoji.thumbs_up) {
 *   console.log("User gave a thumbs up!");
 * }
 *
 * // Works in template strings via toString()
 * await thread.post(`${emoji.thumbs_up} Great job!`);
 * ```
 */
export interface EmojiValue {
  /** The normalized emoji name (e.g., "thumbs_up") */
  readonly name: string;
  /** Returns the placeholder string (for JSON.stringify) */
  toJSON(): string;
  /** Returns the placeholder string for message formatting */
  toString(): string;
}

/**
 * Reaction event fired when a user adds or removes a reaction.
 */
export interface ReactionEvent<TRawMessage = unknown> {
  /** The adapter that received the event */
  adapter: Adapter;
  /** Whether the reaction was added (true) or removed (false) */
  added: boolean;
  /** The normalized emoji as an EmojiValue singleton (enables `===` comparison) */
  emoji: EmojiValue;
  /** The message that was reacted to (if available) */
  message?: Message<TRawMessage>;
  /** The message ID that was reacted to */
  messageId: string;
  /** Platform-specific raw event data */
  raw: unknown;
  /** The raw platform-specific emoji (e.g., "+1" for Slack, "👍" for GChat) */
  rawEmoji: string;
  /**
   * The thread where the reaction occurred.
   * Use this to post replies or check subscription status.
   *
   * @example
   * ```typescript
   * chat.onReaction([emoji.thumbs_up], async (event) => {
   *   await event.thread.post(`Thanks for the ${event.emoji}!`);
   * });
   * ```
   */
  thread: Thread<TRawMessage>;
  /** The thread ID */
  threadId: string;
  /** The user who added/removed the reaction */
  user: Author;
}

/**
 * Handler for reaction events.
 *
 * @example
 * ```typescript
 * // Handle specific emoji
 * chat.onReaction(["thumbs_up", "heart"], async (event) => {
 *   console.log(`${event.user.userName} ${event.added ? "added" : "removed"} ${event.emoji}`);
 * });
 *
 * // Handle all reactions
 * chat.onReaction(async (event) => {
 *   // ...
 * });
 * ```
 */
export type ReactionHandler = (event: ReactionEvent) => void | Promise<void>;

// =============================================================================
// Action Events (Button Clicks)
// =============================================================================

/**
 * Action event fired when a user clicks a button in a card.
 *
 * @example
 * ```typescript
 * chat.onAction("approve", async (event) => {
 *   await event.thread.post(`Order ${event.value} approved by ${event.user.userName}`);
 * });
 * ```
 */
export interface ActionEvent<TRawMessage = unknown> {
  /** The action ID from the button (matches Button's `id` prop) */
  actionId: string;
  /** The adapter that received the event */
  adapter: Adapter;
  /** The message ID containing the card */
  messageId: string;
  /**
   * Open a modal/dialog form in response to this action.
   *
   * @param modal - The modal element to display (JSX or ModalElement)
   * @returns The view/dialog ID, or undefined if modals are not supported
   */
  openModal(
    modal: ModalElement | ChatElement
  ): Promise<{ viewId: string } | undefined>;
  /** Platform-specific raw event data */
  raw: unknown;
  /** The thread where the action occurred (null for view-based actions like home tab buttons) */
  thread: Thread<TRawMessage> | null;
  /** The thread ID */
  threadId: string;
  /** Trigger ID for opening modals (required by some platforms, may expire quickly) */
  triggerId?: string;
  /** User who clicked the button */
  user: Author;
  /** Optional value/payload from the button */
  value?: string;
}

/**
 * Handler for action events (button clicks in cards).
 *
 * @example
 * ```typescript
 * // Handle specific action
 * chat.onAction("approve", async (event) => {
 *   await event.thread.post("Approved!");
 * });
 *
 * // Handle multiple actions
 * chat.onAction(["approve", "reject"], async (event) => {
 *   if (event.actionId === "approve") {
 *     // ...
 *   }
 * });
 *
 * // Handle all actions (catch-all)
 * chat.onAction(async (event) => {
 *   console.log(`Action: ${event.actionId}`);
 * });
 * ```
 */
export type ActionHandler = (event: ActionEvent) => void | Promise<void>;

// =============================================================================
// Options Load Events
// =============================================================================

/**
 * Event emitted when an adapter needs dynamic options for an external select.
 */
export interface OptionsLoadEvent {
  /** The action ID of the select requesting options */
  actionId: string;
  /** The adapter that received this event */
  adapter: Adapter;
  /** The current user-entered query text */
  query: string;
  /** Raw platform-specific payload */
  raw: unknown;
  /** The user requesting options */
  user: Author;
}

export type OptionsLoadHandler = (
  event: OptionsLoadEvent
) =>
  | SelectOptionElement[]
  | Promise<SelectOptionElement[] | undefined>
  | undefined;

// =============================================================================
// Modal Events (Form Submissions)
// =============================================================================

/**
 * Event emitted when a user submits a modal form.
 */
export interface ModalSubmitEvent<TRawMessage = unknown> {
  /** The adapter that received this event */
  adapter: Adapter;
  /** The callback ID specified when creating the modal */
  callbackId: string;
  /**
   * The private metadata string set when the modal was created.
   * Use this to pass arbitrary context (e.g., JSON) through the modal lifecycle.
   */
  privateMetadata?: string;
  /** Raw platform-specific payload */
  raw: unknown;
  /**
   * The channel where the modal was originally triggered from.
   * Available when the modal was opened via SlashCommandEvent.openModal().
   */
  relatedChannel?: Channel<Record<string, unknown>, TRawMessage>;
  /**
   * The message that contained the action which opened the modal.
   * Available when the modal was opened from a message action via ActionEvent.openModal().
   * This is a SentMessage with edit/delete capabilities.
   */
  relatedMessage?: SentMessage<TRawMessage>;
  /**
   * The thread where the modal was originally triggered from.
   * Available when the modal was opened via ActionEvent.openModal().
   */
  relatedThread?: Thread<Record<string, unknown>, TRawMessage>;
  /** The user who submitted the modal */
  user: Author;
  /** Form field values keyed by input ID */
  values: Record<string, string>;
  /** Platform-specific view/dialog ID */
  viewId: string;
}

/**
 * Event emitted when a user closes/cancels a modal (requires notifyOnClose).
 */
export interface ModalCloseEvent<TRawMessage = unknown> {
  /** The adapter that received this event */
  adapter: Adapter;
  /** The callback ID specified when creating the modal */
  callbackId: string;
  /**
   * The private metadata string set when the modal was created.
   * Use this to pass arbitrary context (e.g., JSON) through the modal lifecycle.
   */
  privateMetadata?: string;
  /** Raw platform-specific payload */
  raw: unknown;
  /**
   * The channel where the modal was originally triggered from.
   * Available when the modal was opened via SlashCommandEvent.openModal().
   */
  relatedChannel?: Channel<Record<string, unknown>, TRawMessage>;
  /**
   * The message that contained the action which opened the modal.
   * Available when the modal was opened from a message action via ActionEvent.openModal().
   * This is a SentMessage with edit/delete capabilities.
   */
  relatedMessage?: SentMessage<TRawMessage>;
  /**
   * The thread where the modal was originally triggered from.
   * Available when the modal was opened via ActionEvent.openModal().
   */
  relatedThread?: Thread<Record<string, unknown>, TRawMessage>;
  /** The user who closed the modal */
  user: Author;
  /** Platform-specific view/dialog ID */
  viewId: string;
}

export interface ModalErrorsResponse {
  action: "errors";
  errors: Record<string, string>;
}

export interface ModalUpdateResponse {
  action: "update";
  modal: import("./modals").ModalElement;
}

export interface ModalPushResponse {
  action: "push";
  modal: import("./modals").ModalElement;
}

export interface ModalCloseResponse {
  action: "close";
}

export interface ModalClearResponse {
  action: "clear";
}

export type ModalResponse =
  | ModalCloseResponse
  | ModalClearResponse
  | ModalErrorsResponse
  | ModalUpdateResponse
  | ModalPushResponse;

export type ModalSubmitHandler = (
  event: ModalSubmitEvent
  // biome-ignore lint/suspicious/noConfusingVoidType: void is needed for sync handlers that return nothing
) => void | Promise<ModalResponse | void | undefined>;

export type ModalCloseHandler = (
  event: ModalCloseEvent
) => void | Promise<void>;

// =============================================================================
// Slash Command Events
// =============================================================================

/**
 * Event emitted when a user invokes a slash command.
 *
 * Slash commands are triggered when a user types `/command` in the message composer.
 * The event provides access to the channel where the command was invoked, allowing
 * you to post responses using standard SDK methods.
 *
 * @example
 * ```typescript
 * chat.onSlashCommand("/help", async (event) => {
 *   // Post visible to everyone in the channel
 *   await event.channel.post("Here are the available commands...");
 * });
 *
 * chat.onSlashCommand("/secret", async (event) => {
 *   // Post ephemeral (only the invoking user sees it)
 *   await event.channel.postEphemeral(
 *     event.user,
 *     "This is just for you!",
 *     { fallbackToDM: false }
 *   );
 * });
 *
 * chat.onSlashCommand("/feedback", async (event) => {
 *   // Open a modal
 *   await event.openModal({
 *     type: "modal",
 *     callbackId: "feedback_modal",
 *     title: "Submit Feedback",
 *     children: [{ type: "text_input", id: "feedback", label: "Your feedback" }],
 *   });
 * });
 * ```
 */
export interface SlashCommandEvent<TState = Record<string, unknown>> {
  /** The adapter that received this event */
  adapter: Adapter;

  /** The channel where the command was invoked */
  channel: Channel<TState>;
  /** The slash command name (e.g., "/help") */
  command: string;

  /**
   * Open a modal/dialog form in response to this slash command.
   *
   * @param modal - The modal element to display (JSX or ModalElement)
   * @returns The view/dialog ID, or undefined if modals are not supported
   */
  openModal(
    modal: ModalElement | ChatElement
  ): Promise<{ viewId: string } | undefined>;

  /** Platform-specific raw payload */
  raw: unknown;

  /** Arguments text after the command (e.g., "topic search" from "/help topic search") */
  text: string;

  /** Trigger ID for opening modals (time-limited, typically ~3 seconds) */
  triggerId?: string;

  /** The user who invoked the command */
  user: Author;
}

/**
 * Handler for slash command events.
 *
 * @example
 * ```typescript
 * // Handle a specific command
 * chat.onSlashCommand("/status", async (event) => {
 *   await event.channel.post("All systems operational!");
 * });
 *
 * // Handle multiple commands
 * chat.onSlashCommand(["/help", "/info"], async (event) => {
 *   await event.channel.post(`You invoked ${event.command}`);
 * });
 *
 * // Catch-all handler
 * chat.onSlashCommand(async (event) => {
 *   console.log(`Command: ${event.command}, Args: ${event.text}`);
 * });
 * ```
 */
export type SlashCommandHandler<TState = Record<string, unknown>> = (
  event: SlashCommandEvent<TState>
) => void | Promise<void>;

// =============================================================================
// Assistant Events (Slack Assistants API / AI Apps)
// =============================================================================

export interface AssistantThreadStartedEvent {
  adapter: Adapter;
  channelId: string;
  context: {
    channelId?: string;
    teamId?: string;
    enterpriseId?: string;
    threadEntryPoint?: string;
    forceSearch?: boolean;
  };
  threadId: string;
  threadTs: string;
  userId: string;
}

export type AssistantThreadStartedHandler = (
  event: AssistantThreadStartedEvent
) => void | Promise<void>;

export interface AssistantContextChangedEvent {
  adapter: Adapter;
  channelId: string;
  context: {
    channelId?: string;
    teamId?: string;
    enterpriseId?: string;
    threadEntryPoint?: string;
    forceSearch?: boolean;
  };
  threadId: string;
  threadTs: string;
  userId: string;
}

export type AssistantContextChangedHandler = (
  event: AssistantContextChangedEvent
) => void | Promise<void>;

export interface AppHomeOpenedEvent {
  adapter: Adapter;
  channelId: string;
  userId: string;
}

export type AppHomeOpenedHandler = (
  event: AppHomeOpenedEvent
) => void | Promise<void>;

export interface MemberJoinedChannelEvent {
  adapter: Adapter;
  channelId: string;
  inviterId?: string;
  userId: string;
}

export type MemberJoinedChannelHandler = (
  event: MemberJoinedChannelEvent
) => void | Promise<void>;
