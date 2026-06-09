import type {
  ChannelHistoryApi,
  HistoryApi,
  StateAdapter,
  ThreadHistoryApi,
  TranscriptsConfig,
  UserHistoryApi,
} from "../types";
import { ChannelHistoryApiImpl } from "./channel";
import type { ThreadHistoryCacheLike } from "./thread";
import { ThreadHistoryApiImpl } from "./thread";
import { UserHistoryApiImpl } from "./user";

export { ChannelHistoryApiImpl } from "./channel";
export type { ThreadHistoryCacheLike } from "./thread";
export { ThreadHistoryApiImpl } from "./thread";
export { toPromptEntries } from "./to-prompt";
export type {
  AdapterResolver,
  ListThreadsWithMessagesOptions,
  ListThreadsWithMessagesResult,
  PromptEntry,
  ThreadHistoryCollectOptions,
  ThreadWithMessages,
  // New canonical names
  UserHistoryEntry,
  UserHistoryRole,
} from "./types";
export { UserHistoryApiImpl } from "./user";

/** @internal */
interface HistoryApiImplConfig {
  /**
   * Adapter resolver used by thread and channel sub-APIs.
   * Maps adapter name → Adapter instance (typically `this.adapters.get(name)`
   * on the Chat class, captured as a closure so late-registered adapters are
   * picked up at call time rather than construction time).
   */
  adapterResolver: (name: string) => import("../types").Adapter | undefined;
  /**
   * Optional thread history cache for adapters that persist messages in the
   * SDK-side store (`persistThreadHistory: true`). When provided, the
   * `ThreadHistoryApiImpl` gains `collect()` fallback support and an
   * `append()` method.
   */
  cache?: ThreadHistoryCacheLike;
  /**
   * User-history configuration. When omitted, `history.user` throws on every
   * method call with a descriptive error.
   */
  user?: {
    config: TranscriptsConfig;
    state: StateAdapter;
  };
}

/**
 * Unified History API implementation.
 *
 * Composes {@link UserHistoryApiImpl}, {@link ThreadHistoryApiImpl}, and
 * {@link ChannelHistoryApiImpl} into the {@link HistoryApi} facade.
 *
 * Constructor receives a single config object so `Chat` can pass everything
 * cleanly without positional-argument confusion:
 *
 * ```typescript
 * this._history = new HistoryApiImpl({
 *   user: historyUserConfig
 *     ? { config: historyUserConfig, state: this._stateAdapter }
 *     : undefined,
 *   adapterResolver: (name) => this.adapters.get(name),
 * });
 * ```
 */
export class HistoryApiImpl implements HistoryApi {
  private readonly _user?: UserHistoryApi;
  readonly thread: ThreadHistoryApi;
  readonly channel: ChannelHistoryApi;

  constructor(config: HistoryApiImplConfig) {
    this._user = config.user
      ? new UserHistoryApiImpl(config.user.state, config.user.config)
      : undefined;
    this.thread = new ThreadHistoryApiImpl(
      config.adapterResolver,
      config.cache
    );
    this.channel = new ChannelHistoryApiImpl(config.adapterResolver);
  }

  get user(): UserHistoryApi {
    if (!this._user) {
      throw new Error(
        "chat.history.user is not configured — pass `history.user` (or the legacy `transcripts` + `identity`) to ChatConfig to enable it"
      );
    }
    return this._user;
  }
}
