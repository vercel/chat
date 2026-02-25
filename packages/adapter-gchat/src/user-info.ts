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
  displayName: string;
  email?: string;
}

/**
 * User info cache that stores display names for Google Chat users.
 * Uses both in-memory cache (fast path) and persistent state adapter.
 */
export class UserInfoCache {
  private readonly inMemoryCache = new Map<string, CachedUserInfo>();
  private readonly state: StateAdapter | null;
  private readonly logger: Logger;

  constructor(state: StateAdapter | null, logger: Logger) {
    this.state = state;
    this.logger = logger;
  }

  /**
   * Cache user info for later lookup.
   */
  async set(
    userId: string,
    displayName: string,
    email?: string
  ): Promise<void> {
    if (!displayName || displayName === "unknown") {
      return;
    }

    const userInfo: CachedUserInfo = { displayName, email };

    // Always update in-memory cache
    this.inMemoryCache.set(userId, userInfo);

    // Also persist to state adapter if available
    if (this.state) {
      const cacheKey = `${USER_INFO_KEY_PREFIX}${userId}`;
      await this.state.set<CachedUserInfo>(
        cacheKey,
        userInfo,
        USER_INFO_CACHE_TTL_MS
      );
    }
  }

  /**
   * Get cached user info. Checks in-memory cache first, then falls back to state adapter.
   */
  async get(userId: string): Promise<CachedUserInfo | null> {
    // Check in-memory cache first (fast path)
    const inMemory = this.inMemoryCache.get(userId);
    if (inMemory) {
      return inMemory;
    }

    // Fall back to state adapter
    if (!this.state) {
      return null;
    }

    const cacheKey = `${USER_INFO_KEY_PREFIX}${userId}`;
    const fromState = await this.state.get<CachedUserInfo>(cacheKey);

    // Populate in-memory cache if found in state
    if (fromState) {
      this.inMemoryCache.set(userId, fromState);
    }

    return fromState;
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
    // If display name is provided and not "unknown", use it
    if (providedDisplayName && providedDisplayName !== "unknown") {
      // Also cache it for future use
      this.set(userId, providedDisplayName).catch((err) => {
        this.logger.error("Failed to cache user info", { userId, error: err });
      });
      return providedDisplayName;
    }

    // If this is our bot's user ID, use the configured bot name
    if (botUserId && userId === botUserId) {
      return botUserName;
    }

    // Try to get from cache
    const cached = await this.get(userId);
    if (cached?.displayName) {
      return cached.displayName;
    }

    // Fall back to extracting name from userId (e.g., "users/123" -> "User 123")
    return userId.replace("users/", "User ");
  }
}
