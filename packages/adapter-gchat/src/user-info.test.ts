import type { Logger, StateAdapter } from "chat";
import { describe, expect, it, vi } from "vitest";
import { UserInfoCache } from "./user-info";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

function createMockState() {
  const cache = new Map<string, unknown>();
  return {
    cache,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isSubscribed: vi.fn(),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    extendLock: vi.fn(),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(cache.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      cache.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      cache.delete(key);
      return Promise.resolve();
    }),
  } as unknown as StateAdapter & { cache: Map<string, unknown> };
}

describe("UserInfoCache", () => {
  describe("set", () => {
    it("should store in-memory and persist to state", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      await cache.set("users/123", "John Doe", "john@example.com");

      const result = await cache.get("users/123");
      expect(result).toEqual({
        displayName: "John Doe",
        email: "john@example.com",
      });
    });

    it("should skip empty display names", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      await cache.set("users/123", "");

      const result = await cache.get("users/123");
      expect(result).toBeNull();
    });

    it("should skip 'unknown' display name", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      await cache.set("users/123", "unknown");

      const result = await cache.get("users/123");
      expect(result).toBeNull();
    });

    it("should work without state adapter", async () => {
      const cache = new UserInfoCache(null, mockLogger);

      await cache.set("users/123", "John Doe");

      const result = await cache.get("users/123");
      expect(result).toEqual({ displayName: "John Doe", email: undefined });
    });
  });

  describe("get", () => {
    it("should return from in-memory cache first", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      await cache.set("users/123", "John Doe");

      // Clear state to verify in-memory is used
      state.cache.clear();

      const result = await cache.get("users/123");
      expect(result).toEqual({
        displayName: "John Doe",
        email: undefined,
      });
    });

    it("should fall back to state adapter", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      // Set directly in state to simulate cold cache
      state.cache.set("gchat:user:users/456", {
        displayName: "Jane",
        email: "jane@example.com",
      });

      const result = await cache.get("users/456");
      expect(result).toEqual({
        displayName: "Jane",
        email: "jane@example.com",
      });
    });

    it("should populate in-memory cache on state hit", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      state.cache.set("gchat:user:users/789", {
        displayName: "Bob",
      });

      // First get populates in-memory
      await cache.get("users/789");

      // Clear state; second get should use in-memory
      state.cache.clear();
      const result = await cache.get("users/789");
      expect(result).toEqual({ displayName: "Bob" });
    });

    it("should return null for unknown users", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      const result = await cache.get("users/unknown");
      expect(result).toBeNull();
    });

    it("should return null without state adapter for uncached user", async () => {
      const cache = new UserInfoCache(null, mockLogger);

      const result = await cache.get("users/unknown");
      expect(result).toBeNull();
    });
  });

  describe("resolveDisplayName", () => {
    it("should use provided display name", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      const name = await cache.resolveDisplayName(
        "users/123",
        "John Doe",
        "users/bot",
        "chatbot"
      );
      expect(name).toBe("John Doe");
    });

    it("should skip 'unknown' provided name", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      // Pre-cache a name
      await cache.set("users/123", "Cached Name");

      const name = await cache.resolveDisplayName(
        "users/123",
        "unknown",
        "users/bot",
        "chatbot"
      );
      expect(name).toBe("Cached Name");
    });

    it("should return bot name for bot user ID", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      const name = await cache.resolveDisplayName(
        "users/bot",
        undefined,
        "users/bot",
        "chatbot"
      );
      expect(name).toBe("chatbot");
    });

    it("should use cache for unknown display name", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      await cache.set("users/456", "Cached User");

      const name = await cache.resolveDisplayName(
        "users/456",
        undefined,
        "users/bot",
        "chatbot"
      );
      expect(name).toBe("Cached User");
    });

    it("should fall back to formatted user ID", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      const name = await cache.resolveDisplayName(
        "users/999",
        undefined,
        "users/bot",
        "chatbot"
      );
      expect(name).toBe("User 999");
    });
  });
});
