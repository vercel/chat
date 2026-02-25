import { ChannelImpl, type SerializedChannel } from "./channel";
import {
  getChatSingleton,
  hasChatSingleton,
  setChatSingleton,
} from "./chat-singleton";
import { isJSX, toModalElement } from "./jsx-runtime";
import { Message, type SerializedMessage } from "./message";
import type { ModalElement } from "./modals";
import { type SerializedThread, ThreadImpl } from "./thread";
import type {
  ActionEvent,
  ActionHandler,
  Adapter,
  AppHomeOpenedEvent,
  AppHomeOpenedHandler,
  AssistantContextChangedEvent,
  AssistantContextChangedHandler,
  AssistantThreadStartedEvent,
  AssistantThreadStartedHandler,
  Author,
  Channel,
  ChatConfig,
  ChatInstance,
  EmojiValue,
  Logger,
  LogLevel,
  MentionHandler,
  MessageHandler,
  ModalCloseEvent,
  ModalCloseHandler,
  ModalResponse,
  ModalSubmitEvent,
  ModalSubmitHandler,
  ReactionEvent,
  ReactionHandler,
  SentMessage,
  SlashCommandEvent,
  SlashCommandHandler,
  StateAdapter,
  SubscribedMessageHandler,
  Thread,
  WebhookOptions,
} from "./types";
import { ChatError, ConsoleLogger, LockError } from "./types";

const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds
const SLACK_USER_ID_REGEX = /^U[A-Z0-9]+$/i;
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,19}$/;
/** TTL for message deduplication entries */
const DEDUPE_TTL_MS = 60_000; // 60 seconds
const MODAL_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Server-side stored modal context */
interface StoredModalContext {
  channel?: SerializedChannel;
  message?: SerializedMessage;
  thread?: SerializedThread;
}

interface MessagePattern<TState = Record<string, unknown>> {
  handler: MessageHandler<TState>;
  pattern: RegExp;
}

/** Filter can be EmojiValue objects, emoji names, or raw emoji formats */
type EmojiFilter = EmojiValue | string;

interface ReactionPattern {
  /** If specified, only these emoji trigger the handler. Empty means all emoji. */
  emoji: EmojiFilter[];
  handler: ReactionHandler;
}

interface ActionPattern {
  /** If specified, only these action IDs trigger the handler. Empty means all actions. */
  actionIds: string[];
  handler: ActionHandler;
}

interface ModalSubmitPattern {
  callbackIds: string[];
  handler: ModalSubmitHandler;
}

interface ModalClosePattern {
  callbackIds: string[];
  handler: ModalCloseHandler;
}

interface SlashCommandPattern<TState = Record<string, unknown>> {
  /** If specified, only these commands trigger the handler. Empty means all commands. */
  commands: string[];
  handler: SlashCommandHandler<TState>;
}

/**
 * Type-safe webhook handler that is available for each adapter.
 */
type WebhookHandler = (
  request: Request,
  options?: WebhookOptions
) => Promise<Response>;

/**
 * Creates a type-safe webhooks object based on the adapter names.
 */
type Webhooks<TAdapters extends Record<string, Adapter>> = {
  [K in keyof TAdapters]: WebhookHandler;
};

/**
 * Main Chat class with type-safe adapter inference and custom thread state.
 *
 * @template TAdapters - Map of adapter names to Adapter instances
 * @template TState - Custom state type stored per-thread (default: Record<string, unknown>)
 *
 * @example
 * // Define custom thread state type
 * interface MyThreadState {
 *   aiMode?: boolean;
 *   userName?: string;
 * }
 *
 * const chat = new Chat<typeof adapters, MyThreadState>({
 *   userName: "mybot",
 *   adapters: {
 *     slack: createSlackAdapter({ ... }),
 *     teams: createTeamsAdapter({ ... }),
 *   },
 *   state: createMemoryState(),
 * });
 *
 * // Type-safe thread state
 * chat.onNewMention(async (thread, message) => {
 *   await thread.setState({ aiMode: true });
 *   const state = await thread.state; // Type: MyThreadState | null
 * });
 */
export class Chat<
  TAdapters extends Record<string, Adapter> = Record<string, Adapter>,
  TState = Record<string, unknown>,
> implements ChatInstance
{
  /**
   * Register this Chat instance as the global singleton.
   * Required for Thread deserialization via @workflow/serde.
   *
   * @example
   * ```typescript
   * const chat = new Chat({ ... });
   * chat.registerSingleton();
   *
   * // Now threads can be deserialized without passing chat explicitly
   * const thread = ThreadImpl.fromJSON(serializedThread);
   * ```
   */
  registerSingleton(): this {
    setChatSingleton(this);
    return this;
  }

  /**
   * Get the registered singleton Chat instance.
   * Throws if no singleton has been registered.
   */
  static getSingleton(): Chat {
    return getChatSingleton() as Chat;
  }

  /**
   * Check if a singleton has been registered.
   */
  static hasSingleton(): boolean {
    return hasChatSingleton();
  }

  private readonly adapters: Map<string, Adapter>;
  private readonly _stateAdapter: StateAdapter;
  private readonly userName: string;
  private readonly logger: Logger;
  private readonly _streamingUpdateIntervalMs: number;

  private readonly mentionHandlers: MentionHandler<TState>[] = [];
  private readonly messagePatterns: MessagePattern<TState>[] = [];
  private readonly subscribedMessageHandlers: SubscribedMessageHandler<TState>[] =
    [];
  private readonly reactionHandlers: ReactionPattern[] = [];
  private readonly actionHandlers: ActionPattern[] = [];
  private readonly modalSubmitHandlers: ModalSubmitPattern[] = [];
  private readonly modalCloseHandlers: ModalClosePattern[] = [];
  private readonly slashCommandHandlers: SlashCommandPattern<TState>[] = [];
  private readonly assistantThreadStartedHandlers: AssistantThreadStartedHandler[] =
    [];
  private readonly assistantContextChangedHandlers: AssistantContextChangedHandler[] =
    [];
  private readonly appHomeOpenedHandlers: AppHomeOpenedHandler[] = [];

  /** Initialization state */
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  /**
   * Type-safe webhook handlers keyed by adapter name.
   * @example
   * chat.webhooks.slack(request, { backgroundTask: waitUntil });
   */
  readonly webhooks: Webhooks<TAdapters>;

  constructor(config: ChatConfig<TAdapters>) {
    this.userName = config.userName;
    this._stateAdapter = config.state;
    this.adapters = new Map();
    this._streamingUpdateIntervalMs = config.streamingUpdateIntervalMs ?? 500;

    // Initialize logger
    if (typeof config.logger === "string") {
      this.logger = new ConsoleLogger(config.logger as LogLevel);
    } else {
      this.logger = config.logger || new ConsoleLogger("info");
    }

    // Register adapters and create webhook handlers
    const webhooks = {} as Record<string, WebhookHandler>;
    for (const [name, adapter] of Object.entries(config.adapters)) {
      this.adapters.set(name, adapter);
      // Create webhook handler for each adapter
      webhooks[name] = (request: Request, options?: WebhookOptions) =>
        this.handleWebhook(name, request, options);
    }
    this.webhooks = webhooks as Webhooks<TAdapters>;

    this.logger.debug("Chat instance created", {
      adapters: Object.keys(config.adapters),
    });
  }

  /**
   * Handle a webhook request for a specific adapter.
   * Automatically initializes adapters on first call.
   */
  private async handleWebhook(
    adapterName: string,
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Ensure initialization
    await this.ensureInitialized();

    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      return new Response(`Unknown adapter: ${adapterName}`, { status: 404 });
    }

    return adapter.handleWebhook(request, options);
  }

  /**
   * Ensure the chat instance is initialized.
   * This is called automatically before handling webhooks.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Avoid concurrent initialization
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }

    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.logger.info("Initializing chat instance...");
    await this._stateAdapter.connect();
    this.logger.debug("State connected");

    const initPromises = Array.from(this.adapters.values()).map(
      async (adapter) => {
        this.logger.debug("Initializing adapter", adapter.name);
        const result = await adapter.initialize(this);
        this.logger.debug("Adapter initialized", adapter.name);
        return result;
      }
    );
    await Promise.all(initPromises);

    this.initialized = true;
    this.logger.info("Chat instance initialized", {
      adapters: Array.from(this.adapters.keys()),
    });
  }

  /**
   * Gracefully shut down the chat instance.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down chat instance...");
    await this._stateAdapter.disconnect();
    this.initialized = false;
    this.initPromise = null;
    this.logger.info("Chat instance shut down");
  }

  /**
   * Initialize the chat instance and all adapters.
   * This is called automatically when handling webhooks, but can be called
   * manually for non-webhook use cases (e.g., Gateway listeners).
   */
  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * Register a handler for new @-mentions of the bot.
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
  onNewMention(handler: MentionHandler<TState>): void {
    this.mentionHandlers.push(handler);
    this.logger.debug("Registered mention handler");
  }

  /**
   * Register a handler for messages matching a regex pattern.
   *
   * @param pattern - Regular expression to match against message text
   * @param handler - Handler called when pattern matches
   *
   * @example
   * ```typescript
   * // Match messages starting with "!help"
   * chat.onNewMessage(/^!help/, async (thread, message) => {
   *   await thread.post("Available commands: !help, !status, !ping");
   * });
   * ```
   */
  onNewMessage(pattern: RegExp, handler: MessageHandler<TState>): void {
    this.messagePatterns.push({ pattern, handler });
    this.logger.debug("Registered message pattern handler", {
      pattern: pattern.toString(),
    });
  }

  /**
   * Register a handler for messages in subscribed threads.
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
  onSubscribedMessage(handler: SubscribedMessageHandler<TState>): void {
    this.subscribedMessageHandlers.push(handler);
    this.logger.debug("Registered subscribed message handler");
  }

  /**
   * Register a handler for reaction events.
   *
   * @example
   * ```typescript
   * // Handle specific emoji using EmojiValue objects (recommended)
   * chat.onReaction([emoji.thumbs_up, emoji.heart], async (event) => {
   *   if (event.emoji === emoji.thumbs_up) {
   *     console.log("Thumbs up!");
   *   }
   * });
   *
   * // Handle all reactions
   * chat.onReaction(async (event) => {
   *   console.log(`${event.added ? "Added" : "Removed"} ${event.emoji.name}`);
   * });
   * ```
   *
   * @param emojiOrHandler - Either an array of emoji to filter (EmojiValue or string), or the handler
   * @param handler - The handler (if emoji filter is provided)
   */
  onReaction(handler: ReactionHandler): void;
  onReaction(emoji: EmojiFilter[], handler: ReactionHandler): void;
  onReaction(
    emojiOrHandler: EmojiFilter[] | ReactionHandler,
    handler?: ReactionHandler
  ): void {
    if (typeof emojiOrHandler === "function") {
      // No emoji filter - handle all reactions
      this.reactionHandlers.push({ emoji: [], handler: emojiOrHandler });
      this.logger.debug("Registered reaction handler for all emoji");
    } else if (handler) {
      // Specific emoji filter
      this.reactionHandlers.push({ emoji: emojiOrHandler, handler });
      this.logger.debug("Registered reaction handler", {
        emoji: emojiOrHandler.map((e) => (typeof e === "string" ? e : e.name)),
      });
    }
  }

  /**
   * Register a handler for action events (button clicks in cards).
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
   *     await event.thread.post("Approved!");
   *   } else {
   *     await event.thread.post("Rejected!");
   *   }
   * });
   *
   * // Handle all actions (catch-all)
   * chat.onAction(async (event) => {
   *   console.log(`Action: ${event.actionId}`);
   * });
   * ```
   *
   * @param actionIdOrHandler - Either an action ID, array of action IDs, or the handler
   * @param handler - The handler (if action ID filter is provided)
   */
  onAction(handler: ActionHandler): void;
  onAction(actionIds: string[] | string, handler: ActionHandler): void;
  onAction(
    actionIdOrHandler: string | string[] | ActionHandler,
    handler?: ActionHandler
  ): void {
    if (typeof actionIdOrHandler === "function") {
      // No action filter - handle all actions
      this.actionHandlers.push({ actionIds: [], handler: actionIdOrHandler });
      this.logger.debug("Registered action handler for all actions");
    } else if (handler) {
      // Specific action ID(s) filter
      const actionIds = Array.isArray(actionIdOrHandler)
        ? actionIdOrHandler
        : [actionIdOrHandler];
      this.actionHandlers.push({ actionIds, handler });
      this.logger.debug("Registered action handler", { actionIds });
    }
  }

  onModalSubmit(handler: ModalSubmitHandler): void;
  onModalSubmit(
    callbackIds: string[] | string,
    handler: ModalSubmitHandler
  ): void;
  onModalSubmit(
    callbackIdOrHandler: string | string[] | ModalSubmitHandler,
    handler?: ModalSubmitHandler
  ): void {
    if (typeof callbackIdOrHandler === "function") {
      this.modalSubmitHandlers.push({
        callbackIds: [],
        handler: callbackIdOrHandler,
      });
      this.logger.debug("Registered modal submit handler for all modals");
    } else if (handler) {
      const callbackIds = Array.isArray(callbackIdOrHandler)
        ? callbackIdOrHandler
        : [callbackIdOrHandler];
      this.modalSubmitHandlers.push({ callbackIds, handler });
      this.logger.debug("Registered modal submit handler", { callbackIds });
    }
  }

  onModalClose(handler: ModalCloseHandler): void;
  onModalClose(
    callbackIds: string[] | string,
    handler: ModalCloseHandler
  ): void;
  onModalClose(
    callbackIdOrHandler: string | string[] | ModalCloseHandler,
    handler?: ModalCloseHandler
  ): void {
    if (typeof callbackIdOrHandler === "function") {
      this.modalCloseHandlers.push({
        callbackIds: [],
        handler: callbackIdOrHandler,
      });
      this.logger.debug("Registered modal close handler for all modals");
    } else if (handler) {
      const callbackIds = Array.isArray(callbackIdOrHandler)
        ? callbackIdOrHandler
        : [callbackIdOrHandler];
      this.modalCloseHandlers.push({ callbackIds, handler });
      this.logger.debug("Registered modal close handler", { callbackIds });
    }
  }

  /**
   * Register a handler for slash command events.
   *
   * Slash commands are triggered when a user types `/command` in the message composer.
   * Use `event.channel.post()` or `event.channel.postEphemeral()` to respond.
   *
   * @example
   * ```typescript
   * // Handle a specific command
   * chat.onSlashCommand("/help", async (event) => {
   *   await event.channel.post("Here are the available commands...");
   * });
   *
   * // Handle multiple commands
   * chat.onSlashCommand(["/status", "/health"], async (event) => {
   *   await event.channel.post("All systems operational!");
   * });
   *
   * // Handle all commands (catch-all)
   * chat.onSlashCommand(async (event) => {
   *   console.log(`Received command: ${event.command} ${event.text}`);
   * });
   *
   * // Open a modal from a slash command
   * chat.onSlashCommand("/feedback", async (event) => {
   *   await event.openModal({
   *     callbackId: "feedback_modal",
   *     title: "Submit Feedback",
   *     inputs: [{ id: "feedback", type: "text_input", label: "Your feedback" }],
   *   });
   * });
   * ```
   *
   * @param commandOrHandler - Either a command, array of commands, or the handler
   * @param handler - The handler (if command filter is provided)
   */
  onSlashCommand(handler: SlashCommandHandler<TState>): void;
  onSlashCommand(
    commands: string[] | string,
    handler: SlashCommandHandler<TState>
  ): void;
  onSlashCommand(
    commandOrHandler: string | string[] | SlashCommandHandler<TState>,
    handler?: SlashCommandHandler<TState>
  ): void {
    if (typeof commandOrHandler === "function") {
      this.slashCommandHandlers.push({
        commands: [],
        handler: commandOrHandler,
      });
      this.logger.debug("Registered slash command handler for all commands");
    } else if (handler) {
      const commands = Array.isArray(commandOrHandler)
        ? commandOrHandler
        : [commandOrHandler];
      const normalizedCommands = commands.map((cmd) =>
        cmd.startsWith("/") ? cmd : `/${cmd}`
      );
      this.slashCommandHandlers.push({ commands: normalizedCommands, handler });
      this.logger.debug("Registered slash command handler", {
        commands: normalizedCommands,
      });
    }
  }

  onAssistantThreadStarted(handler: AssistantThreadStartedHandler): void {
    this.assistantThreadStartedHandlers.push(handler);
    this.logger.debug("Registered assistant thread started handler");
  }

  onAssistantContextChanged(handler: AssistantContextChangedHandler): void {
    this.assistantContextChangedHandlers.push(handler);
    this.logger.debug("Registered assistant context changed handler");
  }

  onAppHomeOpened(handler: AppHomeOpenedHandler): void {
    this.appHomeOpenedHandlers.push(handler);
    this.logger.debug("Registered app home opened handler");
  }

  /**
   * Get an adapter by name with type safety.
   */
  getAdapter<K extends keyof TAdapters>(name: K): TAdapters[K] {
    return this.adapters.get(name as string) as TAdapters[K];
  }

  /**
   * Get a JSON.parse reviver function that automatically deserializes
   * chat:Thread and chat:Message objects.
   *
   * Use this when parsing JSON that contains serialized Thread or Message objects
   * (e.g., from workflow engine payloads).
   *
   * @returns A reviver function for JSON.parse
   *
   * @example
   * ```typescript
   * // Parse workflow payload with automatic deserialization
   * const data = JSON.parse(payload, chat.reviver());
   *
   * // data.thread is now a ThreadImpl instance
   * // data.message is now a Message object with Date fields restored
   * await data.thread.post("Hello from workflow!");
   * ```
   */
  reviver(): (key: string, value: unknown) => unknown {
    // Ensure this chat instance is registered as singleton for thread deserialization
    this.registerSingleton();
    return function reviver(_key: string, value: unknown): unknown {
      if (value && typeof value === "object" && "_type" in value) {
        const typed = value as { _type: string };
        if (typed._type === "chat:Thread") {
          return ThreadImpl.fromJSON(value as SerializedThread);
        }
        if (typed._type === "chat:Channel") {
          return ChannelImpl.fromJSON(value as SerializedChannel);
        }
        if (typed._type === "chat:Message") {
          return Message.fromJSON(value as SerializedMessage);
        }
      }
      return value;
    };
  }

  // ChatInstance interface implementations

  /**
   * Process an incoming message from an adapter.
   * Handles waitUntil registration and error catching internally.
   * Adapters should call this instead of handleIncomingMessage directly.
   */
  processMessage(
    adapter: Adapter,
    threadId: string,
    messageOrFactory: Message | (() => Promise<Message>),
    options?: WebhookOptions
  ): void {
    const task = (async () => {
      const message =
        typeof messageOrFactory === "function"
          ? await messageOrFactory()
          : messageOrFactory;
      await this.handleIncomingMessage(adapter, threadId, message);
    })().catch((err) => {
      this.logger.error("Message processing error", { error: err, threadId });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  /**
   * Process an incoming reaction event from an adapter.
   * Handles waitUntil registration and error catching internally.
   */
  processReaction(
    event: Omit<ReactionEvent, "adapter" | "thread"> & { adapter?: Adapter },
    options?: WebhookOptions
  ): void {
    const task = this.handleReactionEvent(event).catch((err) => {
      this.logger.error("Reaction processing error", {
        error: err,
        emoji: event.emoji,
        messageId: event.messageId,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  /**
   * Process an incoming action event (button click) from an adapter.
   * Handles waitUntil registration and error catching internally.
   */
  processAction(
    event: Omit<ActionEvent, "thread" | "openModal"> & { adapter: Adapter },
    options?: WebhookOptions
  ): void {
    const task = this.handleActionEvent(event).catch((err) => {
      this.logger.error("Action processing error", {
        error: err,
        actionId: event.actionId,
        messageId: event.messageId,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  async processModalSubmit(
    event: Omit<
      ModalSubmitEvent,
      "relatedThread" | "relatedMessage" | "relatedChannel"
    >,
    contextId?: string,
    _options?: WebhookOptions
  ): Promise<ModalResponse | undefined> {
    const { relatedThread, relatedMessage, relatedChannel } =
      await this.retrieveModalContext(event.adapter.name, contextId);

    const fullEvent: ModalSubmitEvent = {
      ...event,
      relatedThread,
      relatedMessage,
      relatedChannel,
    };

    for (const { callbackIds, handler } of this.modalSubmitHandlers) {
      if (callbackIds.length === 0 || callbackIds.includes(event.callbackId)) {
        try {
          const response = await handler(fullEvent);
          if (response) {
            return response;
          }
        } catch (err) {
          this.logger.error("Modal submit handler error", {
            error: err,
            callbackId: event.callbackId,
          });
        }
      }
    }
  }

  processModalClose(
    event: Omit<
      ModalCloseEvent,
      "relatedThread" | "relatedMessage" | "relatedChannel"
    >,
    contextId?: string,
    options?: WebhookOptions
  ): void {
    const task = (async () => {
      const { relatedThread, relatedMessage, relatedChannel } =
        await this.retrieveModalContext(event.adapter.name, contextId);

      const fullEvent: ModalCloseEvent = {
        ...event,
        relatedThread,
        relatedMessage,
        relatedChannel,
      };

      for (const { callbackIds, handler } of this.modalCloseHandlers) {
        if (
          callbackIds.length === 0 ||
          callbackIds.includes(event.callbackId)
        ) {
          await handler(fullEvent);
        }
      }
    })().catch((err) => {
      this.logger.error("Modal close handler error", {
        error: err,
        callbackId: event.callbackId,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  /**
   * Process an incoming slash command from an adapter.
   * Handles waitUntil registration and error catching internally.
   */
  processSlashCommand(
    event: Omit<SlashCommandEvent, "channel" | "openModal"> & {
      adapter: Adapter;
      channelId: string;
    },
    options?: WebhookOptions
  ): void {
    const task = this.handleSlashCommandEvent(event).catch((err) => {
      this.logger.error("Slash command processing error", {
        error: err,
        command: event.command,
        text: event.text,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  processAssistantThreadStarted(
    event: AssistantThreadStartedEvent,
    options?: WebhookOptions
  ): void {
    const task = (async () => {
      for (const handler of this.assistantThreadStartedHandlers) {
        await handler(event);
      }
    })().catch((err) => {
      this.logger.error("Assistant thread started handler error", {
        error: err,
        threadId: event.threadId,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  processAssistantContextChanged(
    event: AssistantContextChangedEvent,
    options?: WebhookOptions
  ): void {
    const task = (async () => {
      for (const handler of this.assistantContextChangedHandlers) {
        await handler(event);
      }
    })().catch((err) => {
      this.logger.error("Assistant context changed handler error", {
        error: err,
        threadId: event.threadId,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  processAppHomeOpened(
    event: AppHomeOpenedEvent,
    options?: WebhookOptions
  ): void {
    const task = (async () => {
      for (const handler of this.appHomeOpenedHandlers) {
        await handler(event);
      }
    })().catch((err) => {
      this.logger.error("App home opened handler error", {
        error: err,
        userId: event.userId,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  /**
   * Handle a slash command event internally.
   */
  private async handleSlashCommandEvent(
    event: Omit<SlashCommandEvent, "channel" | "openModal"> & {
      adapter: Adapter;
      channelId: string;
    }
  ): Promise<void> {
    this.logger.debug("Incoming slash command", {
      adapter: event.adapter.name,
      command: event.command,
      text: event.text,
      user: event.user.userName,
    });
    if (event.user.isMe) {
      this.logger.debug("Skipping slash command from self", {
        command: event.command,
      });
      return;
    }
    const channel = new ChannelImpl<TState>({
      id: event.channelId,
      adapter: event.adapter,
      stateAdapter: this._stateAdapter,
    });
    const fullEvent: SlashCommandEvent<TState> = {
      ...event,
      channel,
      openModal: async (modal) => {
        if (!event.triggerId) {
          this.logger.warn("Cannot open modal: no triggerId available");
          return undefined;
        }
        if (!event.adapter.openModal) {
          this.logger.warn(
            `Cannot open modal: ${event.adapter.name} does not support modals`
          );
          return undefined;
        }
        let modalElement: ModalElement = modal as ModalElement;
        if (isJSX(modal)) {
          const converted = toModalElement(modal);
          if (!converted) {
            throw new Error("Invalid JSX element: must be a Modal element");
          }
          modalElement = converted;
        }
        const contextId = crypto.randomUUID();
        this.storeModalContext(
          event.adapter.name,
          contextId,
          undefined,
          undefined,
          channel
        );
        return event.adapter.openModal(
          event.triggerId,
          modalElement,
          contextId
        );
      },
    };
    this.logger.debug("Checking slash command handlers", {
      handlerCount: this.slashCommandHandlers.length,
      command: event.command,
    });
    for (const { commands, handler } of this.slashCommandHandlers) {
      if (commands.length === 0) {
        this.logger.debug("Running catch-all slash command handler");
        await handler(fullEvent);
        continue;
      }
      if (commands.includes(event.command)) {
        this.logger.debug("Running matched slash command handler", {
          command: event.command,
        });
        await handler(fullEvent);
      }
    }
  }

  /**
   * Store modal context server-side with a context ID.
   * Called when opening a modal to preserve thread/message/channel for the submit handler.
   */
  private storeModalContext(
    adapterName: string,
    contextId: string,
    thread?: ThreadImpl<TState>,
    message?: Message,
    channel?: ChannelImpl<TState>
  ): void {
    const key = `modal-context:${adapterName}:${contextId}`;
    const context: StoredModalContext = {
      thread: thread?.toJSON(),
      message: message?.toJSON(),
      channel: channel?.toJSON(),
    };
    this._stateAdapter.set(key, context, MODAL_CONTEXT_TTL_MS).catch((err) => {
      this.logger.error("Failed to store modal context", {
        contextId,
        error: err,
      });
    });
  }

  /**
   * Retrieve and delete modal context from server-side storage.
   * Called when processing modal submit/close to reconstruct thread/message/channel.
   */
  private async retrieveModalContext(
    adapterName: string,
    contextId?: string
  ): Promise<{
    relatedThread: Thread | undefined;
    relatedMessage: SentMessage | undefined;
    relatedChannel: Channel | undefined;
  }> {
    if (!contextId) {
      return {
        relatedThread: undefined,
        relatedMessage: undefined,
        relatedChannel: undefined,
      };
    }

    const key = `modal-context:${adapterName}:${contextId}`;
    const stored = await this._stateAdapter.get<StoredModalContext>(key);

    if (!stored) {
      return {
        relatedThread: undefined,
        relatedMessage: undefined,
        relatedChannel: undefined,
      };
    }

    const adapter = this.adapters.get(adapterName);

    // Reconstruct thread with adapter directly (if present)
    let relatedThread: Thread | undefined;
    if (stored.thread) {
      relatedThread = ThreadImpl.fromJSON(stored.thread, adapter) as Thread;
    }

    // Reconstruct message if present
    let relatedMessage: SentMessage | undefined;
    if (stored.message && relatedThread) {
      const message = Message.fromJSON(stored.message);
      relatedMessage = (
        relatedThread as ThreadImpl<TState>
      ).createSentMessageFromMessage(message);
    }

    // Reconstruct channel if present
    let relatedChannel: Channel | undefined;
    if (stored.channel) {
      relatedChannel = ChannelImpl.fromJSON(stored.channel, adapter) as Channel;
    }

    return { relatedThread, relatedMessage, relatedChannel };
  }

  /**
   * Handle an action event internally.
   */
  private async handleActionEvent(
    event: Omit<ActionEvent, "thread" | "openModal"> & { adapter: Adapter }
  ): Promise<void> {
    this.logger.debug("Incoming action", {
      adapter: event.adapter.name,
      actionId: event.actionId,
      value: event.value,
      user: event.user.userName,
      messageId: event.messageId,
      threadId: event.threadId,
    });

    // Skip actions from self (shouldn't happen, but be safe)
    if (event.user.isMe) {
      this.logger.debug("Skipping action from self", {
        actionId: event.actionId,
      });
      return;
    }

    const isSubscribed = false;
    const messageForThread = event.messageId
      ? new Message({
          id: event.messageId,
          threadId: event.threadId,
          text: "",
          formatted: { type: "root", children: [] },
          raw: event.raw,
          author: event.user,
          metadata: { dateSent: new Date(), edited: false },
          attachments: [],
        })
      : ({} as Message);

    // Create thread for the action event (skip for view-based actions with no threadId)
    const thread = event.threadId
      ? await this.createThread(
          event.adapter,
          event.threadId,
          messageForThread,
          isSubscribed
        )
      : (null as unknown as Thread<TState>);

    // Build full event with thread and openModal helper
    const fullEvent: ActionEvent = {
      ...event,
      thread,
      openModal: async (modal) => {
        if (!event.triggerId) {
          this.logger.warn("Cannot open modal: no triggerId available");
          return undefined;
        }
        if (!event.adapter.openModal) {
          this.logger.warn(
            `Cannot open modal: ${event.adapter.name} does not support modals`
          );
          return undefined;
        }

        // Convert JSX to ModalElement if needed (same pattern as thread.post)
        let modalElement: ModalElement = modal as ModalElement;
        if (isJSX(modal)) {
          const converted = toModalElement(modal);
          if (!converted) {
            throw new Error("Invalid JSX element: must be a Modal element");
          }
          modalElement = converted;
        }

        // Store context server-side and pass contextId to adapter
        const isEphemeralMessage = event.messageId?.startsWith("ephemeral:");
        let message: Message | undefined;
        if (isEphemeralMessage) {
          const recentMessage = thread.recentMessages[0];
          if (recentMessage && typeof recentMessage.toJSON === "function") {
            message = recentMessage as Message;
          }
        } else if (event.messageId && event.adapter.fetchMessage) {
          const fetched = await event.adapter
            .fetchMessage(event.threadId, event.messageId)
            .catch(() => null);
          if (fetched) {
            message = new Message(fetched);
          } else {
            const recentMessage = thread.recentMessages[0];
            if (recentMessage && typeof recentMessage.toJSON === "function") {
              message = recentMessage as Message;
            }
          }
        }
        const contextId = crypto.randomUUID();
        const channel = (thread as ThreadImpl<TState>)
          .channel as ChannelImpl<TState>;
        this.storeModalContext(
          event.adapter.name,
          contextId,
          thread as ThreadImpl<TState>,
          message,
          channel
        );
        return event.adapter.openModal(
          event.triggerId,
          modalElement,
          contextId
        );
      },
    };

    // Run matching handlers
    this.logger.debug("Checking action handlers", {
      handlerCount: this.actionHandlers.length,
      actionId: event.actionId,
    });

    for (const { actionIds, handler } of this.actionHandlers) {
      // If no action ID filter, run handler for all actions
      if (actionIds.length === 0) {
        this.logger.debug("Running catch-all action handler");
        await handler(fullEvent);
        continue;
      }

      // Check if the action matches any of the specified action IDs
      if (actionIds.includes(event.actionId)) {
        this.logger.debug("Running matched action handler", {
          actionId: event.actionId,
        });
        await handler(fullEvent);
      }
    }
  }

  /**
   * Handle a reaction event internally.
   */
  private async handleReactionEvent(
    event: Omit<ReactionEvent, "adapter" | "thread"> & { adapter?: Adapter }
  ): Promise<void> {
    this.logger.debug("Incoming reaction", {
      adapter: event.adapter?.name,
      emoji: event.emoji,
      rawEmoji: event.rawEmoji,
      added: event.added,
      user: event.user.userName,
      messageId: event.messageId,
      threadId: event.threadId,
    });

    // Skip reactions from self
    if (event.user.isMe) {
      this.logger.debug("Skipping reaction from self", {
        emoji: event.emoji,
      });
      return;
    }

    // Adapter is required for thread creation
    if (!event.adapter) {
      this.logger.error("Reaction event missing adapter");
      return;
    }

    // Create thread for the reaction event
    const isSubscribed = await this._stateAdapter.isSubscribed(event.threadId);
    const thread = await this.createThread(
      event.adapter,
      event.threadId,
      event.message ?? ({} as Message),
      isSubscribed
    );

    // Build full event with thread and adapter
    const fullEvent: ReactionEvent = {
      ...event,
      adapter: event.adapter,
      thread,
    };

    // Run matching handlers
    this.logger.debug("Checking reaction handlers", {
      handlerCount: this.reactionHandlers.length,
      emoji: event.emoji.name,
      rawEmoji: event.rawEmoji,
    });

    for (const { emoji: emojiFilter, handler } of this.reactionHandlers) {
      // If no emoji filter, run handler for all reactions
      if (emojiFilter.length === 0) {
        this.logger.debug("Running catch-all reaction handler");
        await handler(fullEvent);
        continue;
      }

      // Check if the reaction matches any of the specified emoji
      const matches = emojiFilter.some((filter) => {
        // EmojiValue object identity comparison (recommended)
        if (filter === fullEvent.emoji) {
          return true;
        }

        // String comparison: check against emoji name or rawEmoji
        const filterName = typeof filter === "string" ? filter : filter.name;
        return (
          filterName === fullEvent.emoji.name ||
          filterName === fullEvent.rawEmoji
        );
      });

      this.logger.debug("Reaction filter check", {
        filterEmoji: emojiFilter.map((e) =>
          typeof e === "string" ? e : e.name
        ),
        eventEmoji: fullEvent.emoji.name,
        matches,
      });

      if (matches) {
        this.logger.debug("Running matched reaction handler");
        await handler(fullEvent);
      }
    }
  }

  getState(): StateAdapter {
    return this._stateAdapter;
  }

  getUserName(): string {
    return this.userName;
  }

  getLogger(prefix?: string): Logger {
    if (prefix) {
      return this.logger.child(prefix);
    }
    return this.logger;
  }

  /**
   * Open a direct message conversation with a user.
   *
   * Accepts either a user ID string or an Author object (from message.author or event.user).
   *
   * The adapter is automatically inferred from the userId format:
   * - Slack: `U...` (e.g., "U00FAKEUSER1")
   * - Teams: `29:...` (e.g., "29:198PbJuw...")
   * - Google Chat: `users/...` (e.g., "users/100000000000000000001")
   * - Discord: numeric snowflake (e.g., "1033044521375764530")
   *
   * @param user - Platform-specific user ID string, or an Author object
   * @returns A Thread that can be used to post messages
   *
   * @example
   * ```ts
   * // Using user ID directly
   * const dmThread = await chat.openDM("U123456");
   * await dmThread.post("Hello via DM!");
   *
   * // Using Author object from a message
   * chat.onSubscribedMessage(async (thread, message) => {
   *   const dmThread = await chat.openDM(message.author);
   *   await dmThread.post("Hello via DM!");
   * });
   * ```
   */
  async openDM(user: string | Author): Promise<Thread<TState>> {
    const userId = typeof user === "string" ? user : user.userId;
    const adapter = this.inferAdapterFromUserId(userId);
    if (!adapter.openDM) {
      throw new ChatError(
        `Adapter "${adapter.name}" does not support openDM`,
        "NOT_SUPPORTED"
      );
    }

    const threadId = await adapter.openDM(userId);
    return this.createThread(adapter, threadId, {} as Message, false);
  }

  /**
   * Get a Channel by its channel ID.
   *
   * The adapter is automatically inferred from the channel ID prefix.
   *
   * @param channelId - Channel ID (e.g., "slack:C123ABC", "gchat:spaces/ABC123")
   * @returns A Channel that can be used to list threads, post messages, iterate messages, etc.
   *
   * @example
   * ```typescript
   * const channel = chat.channel("slack:C123ABC");
   *
   * // Iterate messages newest first
   * for await (const msg of channel.messages) {
   *   console.log(msg.text);
   * }
   *
   * // List threads
   * for await (const t of channel.threads()) {
   *   console.log(t.rootMessage.text, t.replyCount);
   * }
   *
   * // Post to channel
   * await channel.post("Hello channel!");
   * ```
   */
  channel(channelId: string): Channel<TState> {
    const adapterName = channelId.split(":")[0];
    if (!adapterName) {
      throw new ChatError(
        `Invalid channel ID: ${channelId}`,
        "INVALID_CHANNEL_ID"
      );
    }

    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new ChatError(
        `Adapter "${adapterName}" not found for channel ID "${channelId}"`,
        "ADAPTER_NOT_FOUND"
      );
    }

    return new ChannelImpl<TState>({
      id: channelId,
      adapter,
      stateAdapter: this._stateAdapter,
    });
  }

  /**
   * Infer which adapter to use based on the userId format.
   */
  private inferAdapterFromUserId(userId: string): Adapter {
    // Google Chat: users/123456789
    if (userId.startsWith("users/")) {
      const adapter = this.adapters.get("gchat");
      if (adapter) {
        return adapter;
      }
    }

    // Teams: 29:base64string...
    if (userId.startsWith("29:")) {
      const adapter = this.adapters.get("teams");
      if (adapter) {
        return adapter;
      }
    }

    // Slack: U followed by alphanumeric (e.g., U00FAKEUSER1)
    if (SLACK_USER_ID_REGEX.test(userId)) {
      const adapter = this.adapters.get("slack");
      if (adapter) {
        return adapter;
      }
    }

    // Discord: snowflake ID (17-19 digit number)
    if (DISCORD_SNOWFLAKE_REGEX.test(userId)) {
      const adapter = this.adapters.get("discord");
      if (adapter) {
        return adapter;
      }
    }

    throw new ChatError(
      `Cannot infer adapter from userId "${userId}". Expected format: Slack (U...), Teams (29:...), Google Chat (users/...), or Discord (numeric snowflake).`,
      "UNKNOWN_USER_ID_FORMAT"
    );
  }

  /**
   * Handle an incoming message from an adapter.
   * This is called by adapters when they receive a webhook.
   *
   * The Chat class handles common concerns centrally:
   * - Deduplication: Same message may arrive multiple times (e.g., Slack sends
   *   both `message` and `app_mention` events, GChat sends direct webhook + Pub/Sub)
   * - Bot filtering: Messages from the bot itself are skipped
   * - Locking: Only one instance processes a thread at a time
   */
  async handleIncomingMessage(
    adapter: Adapter,
    threadId: string,
    message: Message
  ): Promise<void> {
    this.logger.debug("Incoming message", {
      adapter: adapter.name,
      threadId,
      messageId: message.id,
      text: message.text,
      author: message.author.userName,
      authorUserId: message.author.userId,
      isBot: message.author.isBot,
      isMe: message.author.isMe,
    });

    // Skip messages from self (bot's own messages)
    if (message.author.isMe) {
      this.logger.debug("Skipping message from self (isMe=true)", {
        adapter: adapter.name,
        threadId,
        author: message.author.userName,
      });
      return;
    }

    // Deduplicate messages - same message can arrive via multiple paths
    // (e.g., Slack message + app_mention events, GChat direct webhook + Pub/Sub)
    const dedupeKey = `dedupe:${adapter.name}:${message.id}`;
    const alreadyProcessed = await this._stateAdapter.get<boolean>(dedupeKey);
    if (alreadyProcessed) {
      this.logger.debug("Skipping duplicate message", {
        adapter: adapter.name,
        messageId: message.id,
      });
      return;
    }
    await this._stateAdapter.set(dedupeKey, true, DEDUPE_TTL_MS);

    // Try to acquire lock on thread
    const lock = await this._stateAdapter.acquireLock(
      threadId,
      DEFAULT_LOCK_TTL_MS
    );
    if (!lock) {
      this.logger.warn("Could not acquire lock on thread", { threadId });
      throw new LockError(
        `Could not acquire lock on thread ${threadId}. Another instance may be processing.`
      );
    }

    this.logger.debug("Lock acquired", { threadId, token: lock.token });

    try {
      // Set isMention on the message for handler access
      // Preserve existing isMention if already set (e.g., from Gateway detection)
      message.isMention =
        message.isMention || this.detectMention(adapter, message);

      // Check if this is a subscribed thread first
      const isSubscribed = await this._stateAdapter.isSubscribed(threadId);
      this.logger.debug("Subscription check", {
        threadId,
        isSubscribed,
        subscribedHandlerCount: this.subscribedMessageHandlers.length,
      });

      // Create thread object (with subscription context for optimization)
      const thread = await this.createThread(
        adapter,
        threadId,
        message,
        isSubscribed
      );

      if (isSubscribed) {
        this.logger.debug("Message in subscribed thread - calling handlers", {
          threadId,
          handlerCount: this.subscribedMessageHandlers.length,
        });
        await this.runHandlers(this.subscribedMessageHandlers, thread, message);
        return;
      }

      // Check for @-mention of bot
      if (message.isMention) {
        this.logger.debug("Bot mentioned", {
          threadId,
          text: message.text.slice(0, 100),
        });
        await this.runHandlers(this.mentionHandlers, thread, message);
        return;
      }

      // Check message patterns
      this.logger.debug("Checking message patterns", {
        patternCount: this.messagePatterns.length,
        patterns: this.messagePatterns.map((p) => p.pattern.toString()),
        messageText: message.text,
      });
      let matchedPattern = false;
      for (const { pattern, handler } of this.messagePatterns) {
        const matches = pattern.test(message.text);
        this.logger.debug("Pattern test", {
          pattern: pattern.toString(),
          text: message.text,
          matches,
        });
        if (matches) {
          this.logger.debug("Message matched pattern - calling handler", {
            pattern: pattern.toString(),
          });
          matchedPattern = true;
          await handler(thread, message);
        }
      }

      // Log if no handlers matched
      if (!matchedPattern) {
        this.logger.debug("No handlers matched message", {
          threadId,
          text: message.text.slice(0, 100),
        });
      }
    } finally {
      await this._stateAdapter.releaseLock(lock);
      this.logger.debug("Lock released", { threadId });
    }
  }

  private createThread(
    adapter: Adapter,
    threadId: string,
    initialMessage: Message,
    isSubscribedContext = false
  ): Thread<TState> {
    // Parse thread ID to get channel info
    // Format: "adapter:channel:thread"
    const parts = threadId.split(":");
    const channelId = parts[1] || "";

    // Check if this is a DM
    const isDM = adapter.isDM?.(threadId) ?? false;

    return new ThreadImpl<TState>({
      id: threadId,
      adapter,
      channelId,
      stateAdapter: this._stateAdapter,
      initialMessage,
      isSubscribedContext,
      isDM,
      currentMessage: initialMessage,
      streamingUpdateIntervalMs: this._streamingUpdateIntervalMs,
    });
  }

  /**
   * Detect if the bot was mentioned in the message.
   * All adapters normalize mentions to @name format, so we just check for @username.
   */
  private detectMention(adapter: Adapter, message: Message): boolean {
    const botUserName = adapter.userName || this.userName;
    const botUserId = adapter.botUserId;

    // Primary check: @username format (normalized by all adapters)
    const usernamePattern = new RegExp(
      `@${this.escapeRegex(botUserName)}\\b`,
      "i"
    );
    if (usernamePattern.test(message.text)) {
      return true;
    }

    // Fallback: check for user ID mention if available (e.g., @U_BOT_123)
    if (botUserId) {
      const userIdPattern = new RegExp(
        `@${this.escapeRegex(botUserId)}\\b`,
        "i"
      );
      if (userIdPattern.test(message.text)) {
        return true;
      }

      // Discord format: <@USER_ID> or <@!USER_ID>
      const discordPattern = new RegExp(
        `<@!?${this.escapeRegex(botUserId)}>`,
        "i"
      );
      if (discordPattern.test(message.text)) {
        return true;
      }
    }

    return false;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async runHandlers(
    handlers: Array<
      (thread: Thread<TState>, message: Message) => void | Promise<void>
    >,
    thread: Thread<TState>,
    message: Message
  ): Promise<void> {
    for (const handler of handlers) {
      await handler(thread, message);
    }
  }
}
