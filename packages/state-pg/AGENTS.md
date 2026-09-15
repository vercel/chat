# AGENTS.md — `@chat-adapter/state-pg`

Guidance for coding agents working inside the PostgreSQL state
adapter package. The top-level repository [AGENTS.md](../../AGENTS.md)
covers monorepo-wide build, lint, and release rules — read it
first. This file documents the adapter-specific surface, conventions,
and pitfalls.

## Overview

`@chat-adapter/state-pg` persists Chat SDK state in PostgreSQL using
the [`pg`](https://www.npmjs.com/package/pg) client. Pick this adapter when:

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
│   ├── index.test.ts        # mocked StateAdapter tests
│   └── postgres.integration.test.ts # real database regression tests
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

The unit tests use a `vi.fn()`-backed Postgres stub. They also read the
migration SQL block from `README.md` and the adapter docs and compare it,
whitespace-normalized, to `postgresSchemaStatements`, so documentation
drift fails `pnpm test` without a database.

Real database tests live in `src/postgres.integration.test.ts` and run
only when `POSTGRES_TEST_URL` is exported. Use a disposable database and
an admin role with `CREATEROLE` and `CREATE` on the database; superuser
is not required because the tests grant the admin membership in the
runtime role they create. The tests create UUID-named schemas and
restricted roles, execute `postgresSchemaStatements`, and remove only
those resources afterward. `POSTGRES_TEST_URL` is declared in
`turbo.json` `globalEnv`, so both invocations below see it.

```bash
POSTGRES_TEST_URL=postgres://localhost/chat_test pnpm --filter @chat-adapter/state-pg test
POSTGRES_TEST_URL=postgres://localhost/chat_test pnpm test
```

Never fall back to an application's `POSTGRES_URL` for these tests.

## Public surface

Main exports from `src/index.ts`:

- `createPostgresState(config?)` — primary factory. Auto-detects
  `POSTGRES_URL` (a.k.a. `DATABASE_URL`).
- `PostgresStateAdapter` class — implements the Chat SDK
  `StateAdapter` interface. Public methods cover subscriptions,
  locks, cache, lists, queues, plus `disconnect()`.
- `PostgresStateAdapterOptions` — URL or external-client options union.
- `postgresSchemaStatements` — the complete DDL, in execution order, for
  migration tooling and for the docs parity test.

## Configuration

```typescript
import pg from "pg";
import { createPostgresState } from "@chat-adapter/state-pg";

createPostgresState({
  client: existingPgPool,            // or provide url, not both
  keyPrefix: "chat-sdk",
  logger: customLogger,
  autoCreateSchema: false,           // default true; false for migrations
});
```

Either `url`, `client`, or one of the auto-detected env vars must be
present at runtime. The adapter creates a `pg.Pool` with sensible
defaults when only `url` is provided.

## Schema

By default, `connect()` creates five tables and four expiry indexes by
running `postgresSchemaStatements` in order. That array is the single
source of the DDL; `ensureSchema()` iterates it, the unit tests assert it,
and the SQL blocks in [README.md](README.md#migration-owned-schema) and
the adapter docs must match it statement for statement (a unit test
enforces this). List and queue `seq` columns use `bigserial` sequences.

With `autoCreateSchema: false`, `connect()` issues no DDL. After `SELECT 1`
it runs one read-only probe and rejects with a descriptive error when a
table or grant is missing, so misconfiguration fails at startup rather than
inside the first message. The probe checks only what each operation needs
(`tablePrivileges` in `index.ts`): SELECT/INSERT/DELETE on every table,
UPDATE only on locks, cache, and lists, and `nextval` on the list and queue
sequences via USAGE or UPDATE, skipped for identity columns. Keep that map
in step with the SQL when adding operations. The integration suite runs
under exactly these least-privilege grants. Applications must migrate
first and grant the runtime role at least these privileges plus schema
USAGE. Future schema updates are also the application's responsibility.

There is no `schemaName` option. Queries use unqualified table names and
resolve against PostgreSQL `search_path`. The docs recommend
`ALTER ROLE ... SET search_path` for the runtime role because it survives
transaction-mode poolers, with per-connection `options` as the
direct-connection alternative.

## Locking semantics

`acquireLock(threadId, ttlMs)`:

- Generates a unique token (UUID v4).
- Issues `INSERT ... ON CONFLICT (key_prefix, thread_id) DO UPDATE SET
  token = EXCLUDED.token, expires_at = EXCLUDED.expires_at WHERE
  chat_state_locks.expires_at <= now()`.
- Returns `{ threadId, token, expiresAt }` when the row was inserted or updated, `null`
  otherwise.

`releaseLock(lock)`:

- `DELETE FROM chat_state_locks WHERE key_prefix = $1 AND thread_id =
  $2 AND token = $3`.
- Resolves without a return value.

`forceReleaseLock(threadId)` is unconditional `DELETE`.

PostgreSQL row locking on the `(key_prefix, thread_id)` primary key
gives serialised acquisitions; the `expires_at <= now()` clause lets
expired locks be replaced atomically.

## Capabilities

- Persistence — **yes**.
- Multi-instance — **yes**.
- Subscriptions — **yes**.
- Distributed locking — **yes**, atomic via `ON CONFLICT` upsert.
- Key-value cache — **yes**, with TTL.
- Lists — **yes**, with per-entry TTL.
- Queues — **yes**, with per-entry TTL.
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
- Expired queue entries are purged on enqueue/dequeue.
- Expired list entries are filtered out of reads but are not deleted.

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
the adapter still checks connectivity on `connect()` and does not call
`end()` on `disconnect()`. Concurrent connect calls share initialization;
failed initialization can be retried.

Queries are issued via `pool.query`. There are no implicit transactions.
Individual lock/cache upserts and queue dequeue use atomic SQL statements.

## Error handling

Connection errors are logged and rethrown. Query errors propagate from
`pg` without custom error mapping or automatic adapter-level retries.

## Testing approach

- Unit tests in `index.test.ts` use a mocked pool to verify SQL and lifecycle.
- Real database tests execute `postgresSchemaStatements` with an owner role,
  then exercise state operations under a role without DDL privileges, and
  assert that `connect()` rejects when tables or grants are missing.
- Cache regressions cover expiry without a prior read, the exact `now()`
  boundary, and claims from independent connections.

## Coding conventions

- Use named exports throughout. No default exports.
- Keep SQL close to the operation using the existing parameterized-query
  style.
- TTLs are stored as `timestamptz` columns — never as `interval`
  values — so reads can compare against `now()` without per-row
  math.
- Top-level regex literals only.
- Use parameterized queries everywhere — never string-concatenate
  user input into SQL.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/state-pg` plus `chat` if a public `StateAdapter` type
changed). Schema-changing PRs must additionally:

- Update `postgresSchemaStatements` and the matching SQL blocks in
  `README.md` and `apps/docs/content/adapters/official/postgres.mdx`
  (the unit test fails otherwise).
- Publish the incremental statements (`ALTER TABLE ... ADD COLUMN`,
  `CREATE INDEX IF NOT EXISTS`, ...) in the changeset. `CREATE TABLE IF NOT
  EXISTS` never alters an existing table, so both auto-created and
  migration-owned deployments need them, and `autoCreateSchema: false`
  deployments run no DDL on `connect()` at all.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/postgres.mdx`](../../apps/docs/content/adapters/official/postgres.mdx)
- README: [`packages/state-pg/README.md`](README.md)
- Core StateAdapter contract: [`packages/chat/src/types.ts`](../chat/src/types.ts)
- Sibling state adapters:
  - [`packages/state-memory`](../state-memory)
  - [`packages/state-redis`](../state-redis)
  - [`packages/state-ioredis`](../state-ioredis)
