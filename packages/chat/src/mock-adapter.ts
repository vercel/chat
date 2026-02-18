/**
 * Shared test utilities for chat package tests.
 */
import { vi } from "vitest";
import { parseMarkdown } from "./markdown";
import { Message, type MessageData } from "./message";
import type {
  Adapter,
  FormattedContent,
  Lock,
  Logger,
  StateAdapter,
} from "./types";

/**
 * Mock logger that captures all log calls.
 */
export const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

/**
 * Create a mock adapter for testing.
 * @param name - Adapter name (e.g., "slack", "teams")
 */
export function createMockAdapter(name = "slack"): Adapter {
  return {
    name,
    userName: `${name}-bot`,
    initialize: vi.fn().mockResolvedValue(undefined),
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
        `${name}:${data.channel}:${data.thread}`,
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
        Promise.resolve(`${name}:D${userId}:`),
      ),
    isDM: vi
      .fn()
      .mockImplementation((threadId: string) => threadId.includes(":D")),
    openModal: vi.fn().mockResolvedValue({ viewId: "V123" }),
    channelIdFromThreadId: vi
      .fn()
      .mockImplementation((threadId: string) =>
        threadId.split(":").slice(0, 2).join(":"),
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
      }),
    ),
    postChannelMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: undefined, raw: {} }),
  };
}

/**
 * Mock state adapter with working in-memory storage.
 * Includes a `cache` property for direct access to stored values.
 */
export interface MockStateAdapter extends StateAdapter {
  cache: Map<string, unknown>;
}

/**
 * Create a mock state adapter for testing.
 * Has working in-memory subscriptions, locks, and cache.
 */
export function createMockState(): MockStateAdapter {
  const subscriptions = new Set<string>();
  const locks = new Map<string, Lock>();
  const cache = new Map<string, unknown>();

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
    isSubscribed: vi.fn().mockImplementation(async (id: string) => {
      return subscriptions.has(id);
    }),
    listSubscriptions: vi.fn().mockImplementation(async function* () {
      for (const id of subscriptions) yield id;
    }),
    acquireLock: vi
      .fn()
      .mockImplementation(async (threadId: string, ttlMs: number) => {
        if (locks.has(threadId)) return null;
        const lock: Lock = {
          threadId,
          token: "test-token",
          expiresAt: Date.now() + ttlMs,
        };
        locks.set(threadId, lock);
        return lock;
      }),
    releaseLock: vi.fn().mockImplementation(async (lock: Lock) => {
      locks.delete(lock.threadId);
    }),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation(async (key: string) => {
      return cache.get(key) ?? null;
    }),
    set: vi.fn().mockImplementation(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      cache.delete(key);
    }),
  };
}

/**
 * Create a test message for testing.
 * @param id - Message ID
 * @param text - Message text content
 * @param overrides - Optional overrides for message fields
 */
export function createTestMessage(
  id: string,
  text: string,
  overrides?: Partial<MessageData>,
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
    ...overrides,
  });
}
