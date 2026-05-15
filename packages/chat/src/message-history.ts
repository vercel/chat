/**
 * @deprecated Renamed — import from `./thread-history` instead.
 *
 * This module is preserved for backwards compatibility and re-exports the
 * new names under the old identifiers. New code should use `ThreadHistoryCache`
 * and `ThreadHistoryConfig` directly.
 */

import { ThreadHistoryCache, type ThreadHistoryConfig } from "./thread-history";

/** @deprecated Use `ThreadHistoryConfig` from `./thread-history` instead. */
export type MessageHistoryConfig = ThreadHistoryConfig;

/** @deprecated Use `ThreadHistoryCache` from `./thread-history` instead. */
export const MessageHistoryCache = ThreadHistoryCache;
/** @deprecated Use `ThreadHistoryCache` from `./thread-history` instead. */
export type MessageHistoryCache = ThreadHistoryCache;
