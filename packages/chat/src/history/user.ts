import { Message } from "../message";
import type {
  AppendInput,
  AppendOptions,
  CountQuery,
  DeleteTarget,
  DurationString,
  ListQuery,
  Postable,
  StateAdapter,
  TranscriptEntry,
  TranscriptRole,
  TranscriptsApi,
  TranscriptsConfig,
} from "../types";

/**
 * Storage key prefix.
 *
 * Intentionally kept as `transcripts:user:` — renaming would silently orphan
 * every existing user's stored data. The user-facing names changed; the
 * storage shape didn't.
 */
const KEY_PREFIX = "transcripts:user:";

const DEFAULT_MAX_PER_USER = 200;
const DEFAULT_LIST_LIMIT = 50;
const DURATION_RE = /^(\d+)([smhd])$/;

const TOMBSTONE_MARKER = "__chatSdkTombstone";

interface Tombstone {
  [TOMBSTONE_MARKER]: true;
}

function isTombstone(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[TOMBSTONE_MARKER] === true
  );
}

const MS_PER_UNIT = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

function parseDuration(
  value: number | DurationString | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const match = DURATION_RE.exec(value);
  if (!match) {
    throw new Error(
      `Invalid duration: ${value} (expected number of ms, or "<n>[smhd]")`
    );
  }
  const n = Number.parseInt(match[1] as string, 10);
  const unit = match[2] as keyof typeof MS_PER_UNIT;
  return n * MS_PER_UNIT[unit];
}

function keyFor(userKey: string): string {
  return `${KEY_PREFIX}${userKey}`;
}

/**
 * Cross-platform per-user message history store, backed by
 * `StateAdapter.appendToList`.
 *
 * Distinct from `ThreadHistoryCache` (per-thread, for adapters without
 * server-side history). This store is keyed by a resolved cross-platform
 * user key set by the `IdentityResolver` (resolved by `Chat` before dispatch).
 *
 * Storage key format: `transcripts:user:{userKey}` — unchanged from the
 * legacy `TranscriptsApiImpl` to preserve existing stored data.
 *
 * `UserHistoryApiImpl` supersedes `TranscriptsApiImpl`; see `transcripts.ts`
 * for the backwards-compat re-export alias.
 */
export class UserHistoryApiImpl implements TranscriptsApi {
  private readonly state: StateAdapter;
  private readonly maxPerUser: number;
  private readonly retentionMs: number | undefined;
  private readonly storeFormatted: boolean;

  constructor(state: StateAdapter, config: TranscriptsConfig) {
    this.state = state;
    this.maxPerUser = config.maxPerUser ?? DEFAULT_MAX_PER_USER;
    this.retentionMs = parseDuration(config.retention);
    this.storeFormatted = config.storeFormatted ?? false;
  }

  async append<TState = Record<string, unknown>, TRawMessage = unknown>(
    thread: Postable<TState, TRawMessage>,
    message: Message | AppendInput,
    options?: AppendOptions
  ): Promise<TranscriptEntry | null> {
    const isMessage = message instanceof Message;

    let userKey: string | undefined;
    let role: TranscriptRole;
    let platformMessageId: string | undefined;

    if (isMessage) {
      userKey = message.userKey;
      role = "user";
      platformMessageId = message.id;
      if (!userKey) {
        return null;
      }
    } else {
      userKey = options?.userKey;
      role = message.role;
      platformMessageId = message.platformMessageId;
      if (!userKey) {
        throw new Error(
          "history.user.append: options.userKey is required when appending an AppendInput"
        );
      }
    }

    const entry: TranscriptEntry = {
      id: crypto.randomUUID(),
      userKey,
      role,
      text: message.text,
      platform: thread.adapter.name,
      threadId: thread.id,
      timestamp: Date.now(),
    };
    if (this.storeFormatted && message.formatted) {
      entry.formatted = message.formatted;
    }
    if (platformMessageId !== undefined) {
      entry.platformMessageId = platformMessageId;
    }

    await this.state.appendToList(keyFor(userKey), entry, {
      maxLength: this.maxPerUser,
      ttlMs: this.retentionMs,
    });

    return entry;
  }

  async list(query: ListQuery): Promise<TranscriptEntry[]> {
    const raw = await this.state.getList<TranscriptEntry | Tombstone>(
      keyFor(query.userKey)
    );
    let filtered = raw.filter(
      (entry): entry is TranscriptEntry => !isTombstone(entry)
    );

    if (query.platforms && query.platforms.length > 0) {
      const platforms = new Set(query.platforms);
      filtered = filtered.filter((m) => platforms.has(m.platform));
    }
    if (query.threadId !== undefined) {
      const tid = query.threadId;
      filtered = filtered.filter((m) => m.threadId === tid);
    }
    if (query.roles && query.roles.length > 0) {
      const roles = new Set(query.roles);
      filtered = filtered.filter((m) => roles.has(m.role));
    }

    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    if (filtered.length > limit) {
      filtered = filtered.slice(filtered.length - limit);
    }
    return filtered;
  }

  async count(query: CountQuery): Promise<number> {
    const raw = await this.state.getList(keyFor(query.userKey));
    return raw.filter((entry) => !isTombstone(entry)).length;
  }

  async delete(target: DeleteTarget): Promise<{ deleted: number }> {
    const key = keyFor(target.userKey);
    const existing = await this.state.getList(key);
    const previous = existing.filter((entry) => !isTombstone(entry)).length;
    const tombstone: Tombstone = { [TOMBSTONE_MARKER]: true };
    await this.state.appendToList(key, tombstone, {
      maxLength: 1,
      ttlMs: this.retentionMs,
    });
    return { deleted: previous };
  }
}
