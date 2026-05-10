# AGENTS.md — `@chat-adapter/state-pg`

Guidance for coding agents working inside the PostgreSQL state
adapter package. The top-level repository [AGENTS.md](../../AGENTS.md)
covers monorepo-wide build, lint, and release rules — read it
first. This file documents the adapter-specific surface, conventions,
and pitfalls.

## Overview

`@chat-adapter/state-pg` persists Chat SDK state in PostgreSQL using
the [`pg`](https://www.npmjs.com/package/pg) client (with optional
support for the `postgres` library). Pick this adapter when:

- Postgres is already your primary datastore and you don't want to
  add Redis to the stack.
- You need **rich query** access (analytics, audit, joins) over
  subscriptions / cache / lists.
- You're deploying to platforms with managed Postgres (Vercel
  Postgres, Supabase, Neon, RDS, Cloud SQL) and prefer not to add a
  separate cache.

Trade-offs vs Redis: lock acquisition is slower (single-row
upsert with timestamp comparison instead of `SET NX PX`) and TTL
cleanup must run as a periodic job rather than via Redis's built-in
expiration.

## Directory layout

```
packages/state-pg/
├── src/
│   ├── index.ts             # PostgresStateAdapter + createPostgresState
│   └── index.test.ts        # full StateAdapter contract suite
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/state-pg build
pnpm --filter @chat-adapter/state-pg test
```

The contract tests use a `vi.fn()`-backed Postgres stub. Real-Postgres
tests live in `packages/integration-tests/src/state-pg.test.ts` and
run only when `POSTGRES_URL` is exported.

## Public surface

Main exports from `src/index.ts`:

- `createPostgresState(config?)` — primary factory. Auto-detects
  `POSTGRES_URL` (a.k.a. `DATABASE_URL`).
- `PostgresStateAdapter` class — implements the Chat SDK
  `StateAdapter` interface. Public methods cover subscriptions,
  locks, cache, lists, queues, plus `disconnect()`.
- `PostgresStateAdapterConfig` — configuration type.

## Configuration

```typescript
import pg from "pg";
import { createPostgresState } from "@chat-adapter/state-pg";

createPostgresState({
  url: process.env.POSTGRES_URL,    // or DATABASE_URL
  client: existingPgPool,            // bring your own pg.Pool
  keyPrefix: "chat-sdk",
  logger: customLogger,
  schemaName: "public",              // optional schema override
});
```

Either `url`, `client`, or one of the auto-detected env vars must be
present at runtime. The adapter creates a `pg.Pool` with sensible
defaults when only `url` is provided.

## Schema

The adapter creates these tables automatically on `connect()`:

```sql
chat_state_subscriptions (
  key_prefix    text       not null,
  thread_id     text       not null,
  primary key (key_prefix, thread_id)
)

chat_state_locks (
  key_prefix    text        not null,
  lock_id       text        not null,
  token         text        not null,
  expires_at    timestamptz not null,
  primary key (key_prefix, lock_id)
)

chat_state_cache (
  key_prefix    text        not null,
  cache_key     text        not null,
  value         text        not null,
  expires_at    timestamptz,
  primary key (key_prefix, cache_key)
)

chat_state_lists (
  key_prefix    text        not null,
  list_key      text        not null,
  value         text        not null,
  expires_at    timestamptz,
  inserted_at   timestamptz not null default now(),
  id            bigserial   primary key
)

chat_state_queues (
  key_prefix     text        not null,
  queue_key      text        not null,
  value          text        not null,
  dedupe_key     text,
  expires_at     timestamptz not null,
  inserted_at    timestamptz not null default now(),
  id             bigserial   primary key,
  unique (key_prefix, queue_key, dedupe_key)
)
```

Set `schemaName` to deploy the tables to a non-default schema; all
queries reference `{schemaName}.{tableName}`. Migrations are managed
inside `connect()` — there is no separate migration runner.

## Locking semantics

`acquireLock(lockId, ttlMs)`:

- Generates a unique token (UUID v4).
- Issues `INSERT ... ON CONFLICT (key_prefix, lock_id) DO UPDATE SET
  token = EXCLUDED.token, expires_at = EXCLUDED.expires_at WHERE
  chat_state_locks.expires_at <= now()`.
- Returns `{ token }` when the row was inserted or updated, `null`
  otherwise.

`releaseLock(lockId, token)`:

- `DELETE FROM chat_state_locks WHERE key_prefix = $1 AND lock_id =
  $2 AND token = $3 RETURNING 1`.
- Returns `true` if the lock was held by the caller and released.

`forceReleaseLock(lockId)` is unconditional `DELETE`.

InnoDB-style row locking on the `(key_prefix, lock_id)` primary key
gives serialised acquisitions; the `expires_at <= now()` clause lets
expired locks be replaced atomically.

## Capabilities

- Persistence — **yes**.
- Multi-instance — **yes**.
- Subscriptions — **yes**.
- Distributed locking — **yes**, atomic via `ON CONFLICT` upsert.
- Key-value cache — **yes**, with TTL.
- Lists — **yes**, with per-entry TTL.
- Queues — **yes**, with per-entry TTL + dedupe key.
- Automatic reconnect — **yes** (delegated to `pg.Pool`).
- Cluster — **n/a**; use a multi-replica Postgres or a connection
  pooler (PgBouncer).
- Sentinel — **n/a**.
- Key prefix namespacing — **yes**.

## Expired row cleanup

Postgres does not expire rows automatically. The adapter performs
opportunistic cleanup:

- Expired locks are overwritten on the next `acquireLock` call.
- Expired cache entries are deleted on the next `get` call for the
  same key.
- Expired queue and list entries are filtered out of reads and
  deleted on the next write to the same key.

For high-throughput deployments, run a periodic job:

```sql
DELETE FROM chat_state_locks  WHERE expires_at <= now();
DELETE FROM chat_state_cache  WHERE expires_at <= now();
DELETE FROM chat_state_lists  WHERE expires_at <= now();
DELETE FROM chat_state_queues WHERE expires_at <= now();
```

A scheduled worker once per minute is plenty.

## Connection management

The adapter uses **one** Postgres pool per `PostgresStateAdapter`
instance. If you bring your own `client` (`pg.Pool` or compatible),
the adapter assumes it is already connected and does not call
`end()` on `disconnect()`.

Per-call queries are issued via `pool.query` — there is no implicit
transaction. Composite operations that need atomicity wrap their SQL
in `BEGIN ... COMMIT` blocks via `pool.connect()` checkout.

## Error handling

- `28P01` (invalid_password) → `AuthenticationError`.
- `42501` (insufficient_privilege) → `AuthenticationError` (with a
  message that points to the missing GRANT).
- `08006`, `08003`, `08001` (connection failures) → `NetworkError`.
- `40001` (serialization_failure) → `AdapterRateLimitError` with a
  short retry-after; the adapter retries internally up to 3 times
  before surfacing.
- Other errors propagate as plain `Error` instances since they
  typically indicate programmer error.

## Testing approach

- The contract tests in `index.test.ts` mirror the `state-memory`
  and `state-redis` suites.
- The Postgres client is replaced with a `vi.fn()`-backed stub that
  records SQL + parameters and returns canned `pg.Result` objects.
- Real-Postgres tests live in
  `packages/integration-tests/src/state-pg.test.ts` and run against
  a local Postgres instance only when `POSTGRES_URL` is exported.
- Schema migrations are tested in `index.test.ts` by running
  `connect()` against a fresh stub and asserting on the issued
  `CREATE TABLE` statements.

## Coding conventions

- Use named exports throughout. No default exports.
- All SQL lives at the top of `index.ts` as named template-literal
  constants. Inline SQL strings inside method bodies are an
  anti-pattern.
- TTLs are stored as `timestamptz` columns — never as `interval`
  values — so reads can compare against `now()` without per-row
  math.
- Errors thrown to chat-sdk callers come from `@chat-adapter/shared`
  (`AuthenticationError`, `AdapterRateLimitError`, `NetworkError`).
- Top-level regex literals only.
- Use parameterized queries everywhere — never string-concatenate
  user input into SQL.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/state-pg` plus `chat` if a public `StateAdapter` type
changed). Schema-changing PRs additionally need a note in
`apps/docs/content/adapters/official/postgres.mdx` so existing
deployments understand what migrations the next `connect()` will
run.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/postgres.mdx`](../../apps/docs/content/adapters/official/postgres.mdx)
- README: [`packages/state-pg/README.md`](README.md)
- Core StateAdapter contract: [`packages/chat/src/state.ts`](../chat/src/state.ts)
- Sibling state adapters:
  - [`packages/state-memory`](../state-memory)
  - [`packages/state-redis`](../state-redis)
  - [`packages/state-ioredis`](../state-ioredis)
