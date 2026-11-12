import { createMockState, mockLogger } from "@chat-adapter/tests";
import { describe, expect, it, vi } from "vitest";
import { UserInfoCache } from "./user-info";

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

  describe("set merging", () => {
    it("should keep the cached email, isBot and avatar when a later set omits them", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);
      await cache.set(
        "users/123",
        "John Doe",
        "john@example.com",
        false,
        "https://example.com/a.jpg"
      );

      await cache.set("users/123", "Johnny Doe");

      const expected = {
        avatarUrl: "https://example.com/a.jpg",
        displayName: "Johnny Doe",
        email: "john@example.com",
        isBot: false,
      };
      expect(await cache.get("users/123")).toEqual(expected);
      expect(state.cache.get("gchat:user:users/123")).toEqual(expected);
    });

    it("should merge with an entry that exists only in state", async () => {
      const state = createMockState();
      await new UserInfoCache(state, mockLogger).set(
        "users/123",
        "John Doe",
        "john@example.com"
      );
      const coldCache = new UserInfoCache(state, mockLogger);

      await coldCache.set("users/123", "John Doe");

      expect(state.cache.get("gchat:user:users/123")).toMatchObject({
        email: "john@example.com",
      });
    });

    it("should replace the cached email, isBot and avatar when new values are provided", async () => {
      const cache = new UserInfoCache(createMockState(), mockLogger);
      await cache.set("users/123", "John", "old@example.com", false, "old.jpg");

      await cache.set("users/123", "John", "new@example.com", true, "new.jpg");

      expect(await cache.get("users/123")).toEqual({
        avatarUrl: "new.jpg",
        displayName: "John",
        email: "new@example.com",
        isBot: true,
      });
    });

    it("should treat an empty email as not provided", async () => {
      const cache = new UserInfoCache(createMockState(), mockLogger);

      await cache.set("users/123", "John", "");
      expect((await cache.get("users/123"))?.email).toBeUndefined();

      await cache.set("users/123", "John", "john@example.com");
      await cache.set("users/123", "John", "");
      expect((await cache.get("users/123"))?.email).toBe("john@example.com");
    });

    it("should keep the email when sets with and without it run concurrently on a cold cache", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/123", { displayName: "Old Name" });
      const cache = new UserInfoCache(state, mockLogger);

      await Promise.all([
        cache.set("users/123", "John Doe", "john@example.com"),
        cache.set("users/123", "John Doe"),
      ]);

      expect((await cache.get("users/123"))?.email).toBe("john@example.com");
      expect(state.cache.get("gchat:user:users/123")).toMatchObject({
        email: "john@example.com",
      });
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

  describe("resolveUser", () => {
    it("should return the cached email alongside a provided display name", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);
      await cache.set("users/123", "John Doe", "john@example.com");

      const user = await cache.resolveUser(
        "users/123",
        "Johnny",
        "users/bot",
        "chatbot"
      );

      expect(user).toEqual({
        displayName: "Johnny",
        email: "john@example.com",
      });
    });

    it("should leave the stored entry unchanged after a provided display name and update the in-memory one", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);
      await cache.set("users/123", "John Doe", "john@example.com", false);
      const stored = { ...state.cache.get("gchat:user:users/123") };

      await cache.resolveDisplayName(
        "users/123",
        "Johnny",
        "users/bot",
        "chatbot"
      );
      await vi.waitFor(async () => {
        expect((await cache.get("users/123"))?.displayName).toBe("Johnny");
      });

      expect(await cache.get("users/123")).toEqual({
        avatarUrl: undefined,
        displayName: "Johnny",
        email: "john@example.com",
        isBot: false,
      });
      expect(state.cache.get("gchat:user:users/123")).toEqual(stored);
      expect(stored).toMatchObject({
        displayName: "John Doe",
        email: "john@example.com",
      });
    });

    it("should keep the in-memory email after a provided display name when there is no state adapter", async () => {
      const cache = new UserInfoCache(null, mockLogger);
      await cache.set("users/123", "John Doe", "john@example.com", false);

      await cache.resolveDisplayName(
        "users/123",
        "Johnny",
        "users/bot",
        "chatbot"
      );
      await vi.waitFor(async () => {
        expect((await cache.get("users/123"))?.displayName).toBe("Johnny");
      });

      expect(await cache.get("users/123")).toEqual({
        avatarUrl: undefined,
        displayName: "Johnny",
        email: "john@example.com",
        isBot: false,
      });
    });

    it("should create the stored entry from a provided display name when none exists", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);

      await cache.resolveDisplayName(
        "users/123",
        "Johnny",
        "users/bot",
        "chatbot"
      );

      await vi.waitFor(() => {
        expect(state.cache.get("gchat:user:users/123")).toEqual({
          displayName: "Johnny",
        });
      });
      const coldCache = new UserInfoCache(state, mockLogger);
      expect(
        await coldCache.resolveDisplayName(
          "users/123",
          undefined,
          "users/bot",
          "chatbot"
        )
      ).toBe("Johnny");
    });

    it("should not replace an email stored by another cache while a provided display name was being cached", async () => {
      const state = createMockState();
      let releaseRead: () => void = () => undefined;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      // The lookup read sees no entry. The read made before the name-only
      // write also sees none, and stays in flight until the other cache has
      // stored the email.
      const get = vi
        .spyOn(state, "get")
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async () => {
          await readGate;
          return null;
        });
      const nameOnlyCache = new UserInfoCache(state, mockLogger);
      const webhookCache = new UserInfoCache(state, mockLogger);

      const resolved = nameOnlyCache.resolveUser(
        "users/123",
        "Johnny",
        "users/bot",
        "chatbot"
      );
      await vi.waitFor(() => {
        expect(get).toHaveBeenCalledTimes(2);
      });
      await webhookCache.set("users/123", "John Doe", "john@example.com");
      releaseRead();

      expect(await resolved).toEqual({
        displayName: "Johnny",
        email: undefined,
      });
      await vi.waitFor(() => {
        expect(vi.mocked(state.setIfNotExists)).toHaveBeenCalledWith(
          "gchat:user:users/123",
          { displayName: "Johnny" },
          expect.any(Number)
        );
      });
      expect(state.cache.get("gchat:user:users/123")).toMatchObject({
        displayName: "John Doe",
        email: "john@example.com",
      });
      expect(await nameOnlyCache.getEmail("users/123")).toBe(
        "john@example.com"
      );
    });

    it("should return the cached display name and email when none is provided", async () => {
      const state = createMockState();
      await new UserInfoCache(state, mockLogger).set(
        "users/123",
        "John Doe",
        "john@example.com"
      );
      const coldCache = new UserInfoCache(state, mockLogger);

      const user = await coldCache.resolveUser(
        "users/123",
        undefined,
        "users/bot",
        "chatbot"
      );

      expect(user).toEqual({
        displayName: "John Doe",
        email: "john@example.com",
      });
    });

    it("should return no email for an uncached user", async () => {
      const cache = new UserInfoCache(createMockState(), mockLogger);

      const provided = await cache.resolveUser(
        "users/999",
        "Someone",
        "users/bot",
        "chatbot"
      );
      const fallback = await cache.resolveUser(
        "users/998",
        undefined,
        "users/bot",
        "chatbot"
      );

      expect(provided).toEqual({ displayName: "Someone", email: undefined });
      expect(fallback).toEqual({ displayName: "User 998", email: undefined });
    });

    it("should not look up the 'unknown' user", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:unknown", {
        displayName: "Ghost",
        email: "ghost@example.com",
      });
      const cache = new UserInfoCache(state, mockLogger);

      const user = await cache.resolveUser(
        "unknown",
        undefined,
        "users/bot",
        "chatbot"
      );

      expect(user).toEqual({ displayName: "unknown", email: undefined });
    });

    it("should fall back without an email when the state read fails", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/123", {
        displayName: "John Doe",
        email: "john@example.com",
      });
      vi.spyOn(state, "get").mockRejectedValue(new Error("State error"));
      const cache = new UserInfoCache(state, mockLogger);

      const user = await cache.resolveUser(
        "users/123",
        "Johnny",
        "users/bot",
        "chatbot"
      );

      expect(user).toEqual({ displayName: "Johnny", email: undefined });
    });
  });

  describe("state reads", () => {
    it("should share one state read between concurrent lookups for the same user", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/123", {
        displayName: "John Doe",
        email: "john@example.com",
      });
      const get = vi.spyOn(state, "get");
      const cache = new UserInfoCache(state, mockLogger);

      const users = await Promise.all(
        Array.from({ length: 5 }, () =>
          cache.resolveUser("users/123", undefined, "users/bot", "chatbot")
        )
      );

      expect(users).toEqual(
        Array.from({ length: 5 }, () => ({
          displayName: "John Doe",
          email: "john@example.com",
        }))
      );
      expect(get).toHaveBeenCalledTimes(1);
    });

    it("should read state again after a failed read", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/123", {
        displayName: "John Doe",
        email: "john@example.com",
      });
      vi.spyOn(state, "get").mockRejectedValueOnce(new Error("State error"));
      const cache = new UserInfoCache(state, mockLogger);

      expect(await cache.getEmail("users/123")).toBeUndefined();
      expect(await cache.getEmail("users/123")).toBe("john@example.com");
    });

    it("should not read state for the bot's own user", async () => {
      const state = createMockState();
      const get = vi.spyOn(state, "get");
      const cache = new UserInfoCache(state, mockLogger);

      const user = await cache.resolveUser(
        "users/bot",
        undefined,
        "users/bot",
        "chatbot"
      );

      expect(user).toEqual({ displayName: "chatbot", email: undefined });
      expect(get).not.toHaveBeenCalled();
    });

    it("should cache the name in memory and leave state untouched when set cannot read state", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/123", {
        displayName: "John Doe",
        email: "john@example.com",
      });
      vi.spyOn(state, "get").mockRejectedValueOnce(new Error("State error"));
      const cache = new UserInfoCache(state, mockLogger);

      await cache.set("users/123", "Johnny");

      expect(await cache.get("users/123")).toMatchObject({
        displayName: "Johnny",
      });
      expect(state.cache.get("gchat:user:users/123")).toEqual({
        displayName: "John Doe",
        email: "john@example.com",
      });
    });
  });

  describe("entries cached without an email", () => {
    it("should keep the stored email when a set follows one whose state read failed", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/123", {
        displayName: "John Doe",
        email: "john@example.com",
      });
      vi.spyOn(state, "get").mockRejectedValueOnce(new Error("State error"));
      const cache = new UserInfoCache(state, mockLogger);
      await cache.set("users/123", "Johnny");

      await cache.set("users/123", "Johnny");

      expect(state.cache.get("gchat:user:users/123")).toEqual({
        avatarUrl: undefined,
        displayName: "Johnny",
        email: "john@example.com",
        isBot: undefined,
      });
      expect(await cache.getEmail("users/123")).toBe("john@example.com");
    });

    it("should pick up an email another cache stored after this one cached the name", async () => {
      const state = createMockState();
      const warmCache = new UserInfoCache(state, mockLogger);
      await warmCache.set("users/123", "John Doe");
      expect(await warmCache.getEmail("users/123")).toBeUndefined();

      await new UserInfoCache(state, mockLogger).set(
        "users/123",
        "John Doe",
        "john@example.com",
        false,
        "a.jpg"
      );

      expect(await warmCache.getEmail("users/123")).toBe("john@example.com");
      expect(await warmCache.get("users/123")).toEqual({
        avatarUrl: "a.jpg",
        displayName: "John Doe",
        email: "john@example.com",
        isBot: false,
      });
    });

    it("should not drop an email another cache stored when this one writes the name again", async () => {
      const state = createMockState();
      const warmCache = new UserInfoCache(state, mockLogger);
      await warmCache.set("users/123", "John Doe");
      await new UserInfoCache(state, mockLogger).set(
        "users/123",
        "John Doe",
        "john@example.com"
      );

      await warmCache.set("users/123", "Johnny");

      expect(state.cache.get("gchat:user:users/123")).toMatchObject({
        displayName: "Johnny",
        email: "john@example.com",
      });
    });

    it("should still resolve the in-memory display name when the state read fails", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);
      await cache.set("users/123", "John Doe");
      vi.spyOn(state, "get").mockRejectedValue(new Error("State error"));

      const user = await cache.resolveUser(
        "users/123",
        undefined,
        "users/bot",
        "chatbot"
      );

      expect(user).toEqual({ displayName: "John Doe", email: undefined });
    });

    it("should not read state again once the in-memory entry has an email", async () => {
      const state = createMockState();
      const cache = new UserInfoCache(state, mockLogger);
      await cache.set("users/123", "John Doe", "john@example.com");
      const get = vi.spyOn(state, "get");
      const readsBefore = get.mock.calls.length;

      expect(await cache.getEmail("users/123")).toBe("john@example.com");
      expect(get.mock.calls.length).toBe(readsBefore);
    });
  });

  describe("getEmail", () => {
    it("should return the cached email", async () => {
      const cache = new UserInfoCache(createMockState(), mockLogger);
      await cache.set("users/123", "John Doe", "john@example.com");

      expect(await cache.getEmail("users/123")).toBe("john@example.com");
    });

    it("should return undefined for an uncached user, an empty cached email and the 'unknown' user", async () => {
      const state = createMockState();
      state.cache.set("gchat:user:users/empty", {
        displayName: "Empty",
        email: "",
      });
      state.cache.set("gchat:user:unknown", {
        displayName: "Ghost",
        email: "ghost@example.com",
      });
      const cache = new UserInfoCache(state, mockLogger);

      expect(await cache.getEmail("users/missing")).toBeUndefined();
      expect(await cache.getEmail("users/empty")).toBeUndefined();
      expect(await cache.getEmail("unknown")).toBeUndefined();
    });

    it("should return undefined when the state read fails", async () => {
      const state = createMockState();
      vi.spyOn(state, "get").mockRejectedValue(new Error("State error"));
      const cache = new UserInfoCache(state, mockLogger);

      expect(await cache.getEmail("users/123")).toBeUndefined();
    });
  });
});
