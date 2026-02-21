import type { ChatInstance, Lock, Logger, StateAdapter } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleChatAdapter,
  GoogleChatAdapter,
  type GoogleChatEvent,
} from "./index";
import type { WorkspaceEventNotification } from "./workspace-events";

const GCHAT_PREFIX_PATTERN = /^gchat:/;

// Test credentials
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const TEST_CREDENTIALS = {
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
};

// Mock StateAdapter for testing
function createMockStateAdapter(): StateAdapter & {
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  return {
    storage,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi
      .fn()
      .mockResolvedValue({ threadId: "", token: "", expiresAt: 0 } as Lock),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(storage.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
  };
}

// Mock ChatInstance for testing
function createMockChatInstance(state: StateAdapter): ChatInstance {
  return {
    getState: () => state,
    getLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
  } as unknown as ChatInstance;
}

describe("GoogleChatAdapter", () => {
  it("should export createGoogleChatAdapter function", () => {
    expect(typeof createGoogleChatAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createGoogleChatAdapter({
      credentials: TEST_CREDENTIALS,
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    expect(adapter.name).toBe("gchat");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs without thread name", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const original = {
        spaceName: "spaces/ABC123",
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(GCHAT_PREFIX_PATTERN);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
    });

    it("should encode and decode thread IDs with thread name", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const original = {
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/XYZ789",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      expect(decoded.spaceName).toBe(original.spaceName);
      expect(decoded.threadName).toBe(original.threadName);
    });
  });

  describe("user info caching", () => {
    let adapter: GoogleChatAdapter;
    let mockState: StateAdapter & { storage: Map<string, unknown> };
    let mockChat: ChatInstance;

    beforeEach(async () => {
      adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      mockState = createMockStateAdapter();
      mockChat = createMockChatInstance(mockState);
      await adapter.initialize(mockChat);
    });

    it("should cache user info from direct webhook messages", () => {
      const event: GoogleChatEvent = {
        chat: {
          messagePayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: {
                name: "users/123456789",
                displayName: "John Doe",
                type: "HUMAN",
                email: "john@example.com",
              },
              text: "Hello",
              createTime: new Date().toISOString(),
            },
          },
        },
      };

      adapter.parseMessage(event);

      // Verify user info was cached
      expect(mockState.set).toHaveBeenCalledWith(
        "gchat:user:users/123456789",
        { displayName: "John Doe", email: "john@example.com" },
        expect.any(Number)
      );
    });

    it("should not cache user info when displayName is unknown", () => {
      const event: GoogleChatEvent = {
        chat: {
          messagePayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: {
                name: "users/123456789",
                displayName: "unknown",
                type: "HUMAN",
              },
              text: "Hello",
              createTime: new Date().toISOString(),
            },
          },
        },
      };

      adapter.parseMessage(event);

      // Verify user info was NOT cached
      expect(mockState.set).not.toHaveBeenCalledWith(
        "gchat:user:users/123456789",
        expect.anything(),
        expect.any(Number)
      );
    });

    it("should resolve user display name from cache for Pub/Sub messages", async () => {
      // Pre-populate cache
      mockState.storage.set("gchat:user:users/123456789", {
        displayName: "Jane Smith",
        email: "jane@example.com",
      });

      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/123456789",
            type: "HUMAN",
            // Note: displayName is missing in Pub/Sub messages
          },
          text: "Hello from Pub/Sub",
          createTime: new Date().toISOString(),
        },
      };

      // Access private method via any cast for testing
      const parsedMessage = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(parsedMessage.author.fullName).toBe("Jane Smith");
      expect(parsedMessage.author.userName).toBe("Jane Smith");
    });

    it("should fall back to User ID when cache miss", async () => {
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/987654321",
            type: "HUMAN",
          },
          text: "Hello from unknown user",
          createTime: new Date().toISOString(),
        },
      };

      const parsedMessage = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      // Should fall back to "User {numeric_id}"
      expect(parsedMessage.author.fullName).toBe("User 987654321");
      expect(parsedMessage.author.userName).toBe("User 987654321");
    });

    it("should use provided displayName if available and cache it", async () => {
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/111222333",
            displayName: "Bob Wilson",
            type: "HUMAN",
          },
          text: "Hello with displayName",
          createTime: new Date().toISOString(),
        },
      };

      const parsedMessage = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(parsedMessage.author.fullName).toBe("Bob Wilson");

      // Should also cache the displayName for future use
      // Wait a tick for the async cache operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockState.storage.get("gchat:user:users/111222333")).toEqual({
        displayName: "Bob Wilson",
        email: undefined,
      });
    });
  });
});
