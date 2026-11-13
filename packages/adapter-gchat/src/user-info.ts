/**
 * User info caching utilities for Google Chat adapter.
 *
 * Google Chat Pub/Sub messages don't include user display names,
 * so we cache them from direct webhook messages for later use.
 */

import type { Logger, StateAdapter } from "chat";

/** Key prefix for user info cache */
const USER_INFO_KEY_PREFIX = "gchat:user:";
/** TTL for user info cache (7 days) */
const USER_INFO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cached user info */
export interface CachedUserInfo {
  avatarUrl?: string;
  displayName: string;
  email?: string;
  isBot?: boolean;
}

/** Display name and email resolved for a message or event user */
export interface ResolvedUser {
  displayName: string;
  email?: string;
}

/**
 * Result of a cache read. `complete` is false when the state adapter could
 * not be read, so `info` may be missing fields that are stored there.
 */
interface CacheRead {
  complete: boolean;
  info: CachedUserInfo | null;
}

/**
 * User info cache that stores display names for Google Chat users.
 * Uses both in-memory cache (fast path) and persistent state adapter.
 */
export class UserInfoCache {
  private readonly inMemoryCache = new Map<string, CachedUserInfo>();
  private readonly pendingReads = new Map<string, Promise<CacheRead>>();
  private readonly state: StateAdapter | null;
  private readonly logger: Logger;

  constructor(state: StateAdapter | null, logger: Logger) {
    this.state = state;
    this.logger = logger;
  }

  /**
   * Cache user info for later lookup. Fields that are not provided keep
   * their previously cached value.
   */
  async set(
    userId: string,
    displayName: string,
    email?: string,
    isBot?: boolean,
    avatarUrl?: string
  ): Promise<void> {
    if (!displayName || displayName === "unknown") {
      return;
    }

    const { info: fromCache, complete } = await this.read(userId);
    // Another set() may have completed while the read was in flight.
    const existing = this.inMemoryCache.get(userId) ?? fromCache;
    const userInfo: CachedUserInfo = {
      avatarUrl: avatarUrl ?? existing?.avatarUrl,
      displayName,
      email: email || existing?.email || undefined,
      isBot: isBot ?? existing?.isBot,
    };

    // Always update in-memory cache
    this.inMemoryCache.set(userId, userInfo);

    // Persist to the state adapter if available. Without a successful read
    // the merge is incomplete, and writing it could drop stored fields.
    if (this.state && complete) {
      const cacheKey = `${USER_INFO_KEY_PREFIX}${userId}`;
      await this.state.set<CachedUserInfo>(
        cacheKey,
        userInfo,
        USER_INFO_CACHE_TTL_MS
      );
    }
  }

  /**
   * Get cached user info from the in-memory cache and the state adapter.
   * Returns null when the user is not cached or the state read fails.
   */
  async get(userId: string): Promise<CachedUserInfo | null> {
    const { info } = await this.read(userId);
    return info;
  }

  private read(userId: string): Promise<CacheRead> {
    // An in-memory entry with an email is complete (fast path). One without
    // an email may be behind the state adapter, where another instance can
    // have stored the email since.
    const inMemory = this.inMemoryCache.get(userId) ?? null;
    const state = this.state;
    if (inMemory?.email || !state) {
      return Promise.resolve({ complete: true, info: inMemory });
    }

    // Concurrent lookups for the same user share one state read
    const pending = this.pendingReads.get(userId);
    if (pending) {
      return pending;
    }

    const read = this.readFromState(state, userId).finally(() => {
      this.pendingReads.delete(userId);
    });
    this.pendingReads.set(userId, read);
    return read;
  }

  private async readFromState(
    state: StateAdapter,
    userId: string
  ): Promise<CacheRead> {
    const cacheKey = `${USER_INFO_KEY_PREFIX}${userId}`;
    let fromState: CachedUserInfo | null;
    try {
      fromState = await state.get<CachedUserInfo>(cacheKey);
    } catch (error) {
      this.logger.warn("Failed to read cached user info", { userId, error });
      return {
        complete: false,
        info: this.inMemoryCache.get(userId) ?? null,
      };
    }

    const inMemory = this.inMemoryCache.get(userId);
    if (!fromState) {
      return { complete: true, info: inMemory ?? null };
    }

    const info: CachedUserInfo = inMemory
      ? {
          avatarUrl: inMemory.avatarUrl ?? fromState.avatarUrl,
          displayName: inMemory.displayName,
          email: inMemory.email || fromState.email || undefined,
          isBot: inMemory.isBot ?? fromState.isBot,
        }
      : fromState;
    this.inMemoryCache.set(userId, info);
    return { complete: true, info };
  }

  /**
   * Get the cached email for a user. Returns undefined when the user is
   * unknown, has no cached email, or the cache lookup fails.
   */
  async getEmail(userId: string): Promise<string | undefined> {
    const cached = await this.lookup(userId);
    return cached?.email || undefined;
  }

  /**
   * Resolve user display name, using cache if available.
   *
   * @param userId - The user's resource name (e.g., "users/123456")
   * @param providedDisplayName - Display name from the message if available
   * @param botUserId - The bot's user ID (for self-identification)
   * @param botUserName - The bot's configured username
   */
  async resolveDisplayName(
    userId: string,
    providedDisplayName: string | undefined,
    botUserId: string | undefined,
    botUserName: string
  ): Promise<string> {
    const user = await this.resolveUser(
      userId,
      providedDisplayName,
      botUserId,
      botUserName
    );
    return user.displayName;
  }

  /**
   * Resolve a user's display name and email, using cache if available.
   * The email comes from the cache only, so it is set for users previously
   * seen with one.
   *
   * @param userId - The user's resource name (e.g., "users/123456")
   * @param providedDisplayName - Display name from the message if available
   * @param botUserId - The bot's user ID (for self-identification)
   * @param botUserName - The bot's configured username
   */
  async resolveUser(
    userId: string,
    providedDisplayName: string | undefined,
    botUserId: string | undefined,
    botUserName: string
  ): Promise<ResolvedUser> {
    // The bot's own user is never cached with an email, so skip the lookup
    const isSelf = botUserId !== undefined && userId === botUserId;
    const cached = isSelf ? null : await this.lookup(userId);
    const email = cached?.email || undefined;

    // If display name is provided and not "unknown", use it
    if (providedDisplayName && providedDisplayName !== "unknown") {
      // Also cache it for future use
      this.rememberDisplayName(userId, providedDisplayName).catch((err) => {
        this.logger.error("Failed to cache user info", { userId, error: err });
      });
      return { displayName: providedDisplayName, email };
    }

    // If this is our bot's user ID, use the configured bot name
    if (isSelf) {
      return { displayName: botUserName, email };
    }

    if (cached?.displayName) {
      return { displayName: cached.displayName, email };
    }

    // Fall back to extracting name from userId (e.g., "users/123" -> "User 123")
    return { displayName: userId.replace("users/", "User "), email };
  }

  /**
   * Cache a display name seen without the rest of the user's info. Updates
   * the in-memory entry, and creates the state entry only when none exists,
   * so it never replaces one written from a webhook message.
   */
  private async rememberDisplayName(
    userId: string,
    displayName: string
  ): Promise<void> {
    const { info: fromCache } = await this.read(userId);
    const existing = this.inMemoryCache.get(userId) ?? fromCache;
    const userInfo: CachedUserInfo = { ...existing, displayName };

    this.inMemoryCache.set(userId, userInfo);

    if (this.state) {
      const cacheKey = `${USER_INFO_KEY_PREFIX}${userId}`;
      await this.state.setIfNotExists(
        cacheKey,
        userInfo,
        USER_INFO_CACHE_TTL_MS
      );
    }
  }

  private async lookup(userId: string): Promise<CachedUserInfo | null> {
    if (!userId || userId === "unknown") {
      return null;
    }
    return await this.get(userId);
  }
}
