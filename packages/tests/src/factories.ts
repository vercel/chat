import {
  type Adapter,
  type ChatInstance,
  type FormattedContent,
  type Lock,
  type Logger,
  Message,
  type MessageData,
  parseMarkdown,
  type QueueEntry,
  type StateAdapter,
} from "chat";
import { vi } from "vitest";

/**
 * Mock logger that captures all log calls via `vi.fn()`.
 * Re-used across `child()` so assertions on a parent surface child calls too.
 */
export const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

/**
 * Create a fresh mock logger with its own `vi.fn()` instances.
 * Use when a test needs isolation from other tests sharing `mockLogger`.
 */
export function createMockLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
}

/**
 * Create a mock `Adapter` for testing. Every method is a `vi.fn()` returning
 * a sensible default. Pass `overrides` to replace specific methods or fields.
 *
 * @param name Adapter name (e.g. `"slack"`, `"teams"`). Used in the default
 *   `encodeThreadId`/`decodeThreadId` implementations and in derived defaults.
 * @param overrides Partial overrides merged on top of the defaults.
 */
export function createMockAdapter(
  name = "slack",
  overrides?: Partial<Adapter>
): Adapter {
  const base: Adapter = {
    name,
    userName: `${name}-bot`,
    initialize: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    handleWebhook: vi.fn().mockResolvedValue(new Response("ok")),
    postMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: undefined, raw: {} }),
    editMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: undefined, raw: {} }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
    fetchMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], nextCursor: undefined }),
    fetchThread: vi
      .fn()
      .mockResolvedValue({ id: "t1", channelId: "c1", metadata: {} }),
    fetchMessage: vi.fn().mockResolvedValue(null),
    encodeThreadId: vi.fn(
      (data: { channel: string; thread: string }) =>
        `${name}:${data.channel}:${data.thread}`
    ),
    decodeThreadId: vi.fn((id: string) => {
      const [, channel, thread] = id.split(":");
      return { channel, thread };
    }),
    parseMessage: vi.fn(),
    renderFormatted: vi.fn((_content: FormattedContent) => "formatted"),
    openDM: vi
      .fn()
      .mockImplementation((userId: string) =>
        Promise.resolve(`${name}:D${userId}:`)
      ),
    isDM: vi
      .fn()
      .mockImplementation((threadId: string) => threadId.includes(":D")),
    getChannelVisibility: vi.fn().mockReturnValue("unknown"),
    openModal: vi.fn().mockResolvedValue({ viewId: "V123" }),
    channelIdFromThreadId: vi
      .fn()
      .mockImplementation((threadId: string) =>
        threadId.split(":").slice(0, 2).join(":")
      ),
    fetchChannelMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], nextCursor: undefined }),
    listThreads: vi
      .fn()
      .mockResolvedValue({ threads: [], nextCursor: undefined }),
    fetchChannelInfo: vi.fn().mockImplementation((channelId: string) =>
      Promise.resolve({
        id: channelId,
        name: `#${channelId}`,
        isDM: false,
        metadata: {},
      })
    ),
    postChannelMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: undefined, raw: {} }),
  };
  return overrides ? { ...base, ...overrides } : base;
}

/**
 * Mock state adapter with working in-memory storage.
 * `cache` exposes the underlying map for direct inspection in tests.
 */
export interface MockStateAdapter extends StateAdapter {
  cache: Map<string, unknown>;
}

/**
 * Create a `StateAdapter` backed by in-memory `Map`s — subscriptions, locks,
 * key/value cache, lists, and queues all work end-to-end.
 *
 * Each call returns isolated state, so tests don't leak between runs.
 */
export function createMockState(): MockStateAdapter {
  const subscriptions = new Set<string>();
  const locks = new Map<string, Lock>();
  const cache = new Map<string, unknown>();
  const queues = new Map<string, QueueEntry[]>();

  return {
    cache,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockImplementation(async (id: string) => {
      subscriptions.add(id);
    }),
    unsubscribe: vi.fn().mockImplementation(async (id: string) => {
      subscriptions.delete(id);
    }),
    isSubscribed: vi
      .fn()
      .mockImplementation(async (id: string) => subscriptions.has(id)),
    acquireLock: vi
      .fn()
      .mockImplementation(async (threadId: string, ttlMs: number) => {
        if (locks.has(threadId)) {
          return null;
        }
        const lock: Lock = {
          threadId,
          token: "test-token",
          expiresAt: Date.now() + ttlMs,
        };
        locks.set(threadId, lock);
        return lock;
      }),
    forceReleaseLock: vi.fn().mockImplementation(async (threadId: string) => {
      locks.delete(threadId);
    }),
    releaseLock: vi.fn().mockImplementation(async (lock: Lock) => {
      locks.delete(lock.threadId);
    }),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi
      .fn()
      .mockImplementation(async (key: string) => cache.get(key) ?? null),
    set: vi.fn().mockImplementation(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    setIfNotExists: vi
      .fn()
      .mockImplementation(async (key: string, value: unknown) => {
        if (cache.has(key)) {
          return false;
        }
        cache.set(key, value);
        return true;
      }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      cache.delete(key);
    }),
    appendToList: vi
      .fn()
      .mockImplementation(
        async (
          key: string,
          value: unknown,
          options?: { maxLength?: number; ttlMs?: number }
        ) => {
          let list = (cache.get(key) as unknown[]) ?? [];
          list.push(value);
          if (options?.maxLength && list.length > options.maxLength) {
            list = list.slice(list.length - options.maxLength);
          }
          cache.set(key, list);
        }
      ),
    enqueue: vi
      .fn()
      .mockImplementation(
        async (threadId: string, entry: QueueEntry, maxSize: number) => {
          let queue = queues.get(threadId);
          if (!queue) {
            queue = [];
            queues.set(threadId, queue);
          }
          queue.push(entry);
          if (queue.length > maxSize) {
            queue.splice(0, queue.length - maxSize);
          }
          return queue.length;
        }
      ),
    dequeue: vi.fn().mockImplementation(async (threadId: string) => {
      const queue = queues.get(threadId);
      if (!queue || queue.length === 0) {
        return null;
      }
      const entry = queue.shift();
      if (queue.length === 0) {
        queues.delete(threadId);
      }
      return entry ?? null;
    }),
    queueDepth: vi
      .fn()
      .mockImplementation(
        async (threadId: string) => queues.get(threadId)?.length ?? 0
      ),
    getList: vi
      .fn()
      .mockImplementation(
        async (key: string) => (cache.get(key) as unknown[]) ?? []
      ),
  };
}

/**
 * Options for `createMockChatInstance`.
 */
export interface MockChatInstanceOptions {
  /** Logger. Defaults to `mockLogger`. */
  logger?: Logger;
  /** Partial overrides applied last (e.g. to swap a single processor). */
  overrides?: Partial<ChatInstance>;
  /** State adapter to back the instance. Defaults to a fresh `createMockState()`. */
  state?: StateAdapter;
  /** Bot user name returned by `getUserName()`. Defaults to `"test-bot"`. */
  userName?: string;
}

/**
 * Create a mock `ChatInstance` for adapter authors who need to verify their
 * adapter dispatches incoming events through the right `process*` hook.
 *
 * Every processor is a `vi.fn()`; `getState()`/`getUserName()`/`getLogger()`
 * are wired up to the supplied (or default) state and logger.
 */
export function createMockChatInstance(
  options: MockChatInstanceOptions = {}
): ChatInstance {
  const state = options.state ?? createMockState();
  const logger = options.logger ?? mockLogger;
  const userName = options.userName ?? "test-bot";

  const base = {
    processMessage: vi.fn(),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processOptionsLoad: vi.fn().mockResolvedValue(undefined),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
    processSlashCommand: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
    processAppHomeOpened: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAppContextChanged: vi.fn(),
    transcripts: { record: vi.fn().mockResolvedValue(undefined) },
    getState: () => state,
    getUserName: () => userName,
    getLogger: () => logger,
  } as unknown as ChatInstance;

  return options.overrides ? { ...base, ...options.overrides } : base;
}

/**
 * Build a `Message` for tests. `text` is parsed into the formatted AST so
 * assertions on `message.formatted` work without manual setup.
 */
export function createTestMessage(
  id: string,
  text: string,
  overrides?: Partial<MessageData>
): Message {
  return new Message({
    id,
    threadId: "slack:C123:1234.5678",
    text,
    formatted: parseMarkdown(text),
    raw: {},
    author: {
      userId: "U123",
      userName: "testuser",
      fullName: "Test User",
      isBot: false,
      isMe: false,
    },
    metadata: {
      dateSent: new Date("2024-01-15T10:30:00.000Z"),
      edited: false,
    },
    attachments: [],
    links: [],
    ...overrides,
  });
}
