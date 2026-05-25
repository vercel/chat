# AGENTS.md — `@chat-adapter/state-d1`

Guidance for coding agents working inside the Cloudflare D1 state
adapter package. The top-level repository [AGENTS.md](../../AGENTS.md)
covers monorepo-wide build, lint, and release rules — read it first.
This file documents the adapter-specific surface, conventions, and
pitfalls.

## Overview

`@chat-adapter/state-d1` persists Chat SDK state in a Cloudflare D1
(SQLite) database. Pick this adapter when:

- You deploy your bot on Cloudflare Workers and want durable state
  without provisioning a separate Redis or Postgres.
- A single SQLite-backed store is sufficient for subscriptions,
  locks, cache, lists, and per-thread queues.

The D1 binding is **always injected** via `options.database` — the
adapter never opens its own connection and never closes one. There is
no URL/client union (unlike `state-pg`).

## Directory layout

```
packages/state-d1/
├── src/
│   ├── index.ts          # D1StateAdapter + createD1State
│   ├── index.test.ts     # full StateAdapter contract suite (real D1)
│   └── env.d.ts          # cloudflare:test ProvidedEnv { DB }
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts      # @cloudflare/vitest-pool-workers
├── wrangler.jsonc        # D1 test binding
├── AGENTS.md
├── CLAUDE.md
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
pnpm --filter @chat-adapter/state-d1 build
pnpm --filter @chat-adapter/state-d1 test
pnpm turbo test --filter=@chat-adapter/state-d1
```

## Testing

Tests run against a **real D1 database** via miniflare, using
`@cloudflare/vitest-pool-workers`. `vitest.config.ts` uses the
`cloudflareTest()` plugin with `defineProject` and provides the `DB`
binding through `miniflare: { d1Databases: ["DB"] }`. Tests import
`{ env }` from `cloudflare:test` and call
`createD1State({ database: env.DB })`.

Key constraints:

- `vitest` is pinned to `^4.1.7` for this package (the pool requires
  ≥4.1); the rest of the repo is on 4.0.x. This divergence is
  intentional — keep it.
- **No coverage** — `@vitest/coverage-v8` does not work under
  `workerd`, so the `test` script is plain `vitest run` with no
  `--coverage` flag. Do not add coverage here.
- The pool resets D1 storage between test **files**. For per-test
  isolation inside one file, the suite uses a unique `keyPrefix` per
  adapter instance.
- TTL-expiry assertions use short real `setTimeout` delays
  (10–40 ms), since `workerd`'s clock cannot be fast-forwarded for
  `Date.now()`-based expiry stored in the DB.

## Public surface

Main exports from `src/index.ts`:

- `createD1State(options)` — primary factory. Named export only.
- `D1StateAdapter` class — implements the Chat SDK `StateAdapter`
  interface (all 18 methods). Throws from the constructor if
  `options.database` is missing.
- `D1StateAdapterOptions` — configuration interface.

No default export.

## Configuration

```typescript
import { createD1State } from "@chat-adapter/state-d1";

createD1State({
  database: env.DB,       // required D1 binding
  keyPrefix: "chat-sdk",  // optional, namespaces all rows
  logger: customLogger,   // optional, defaults to ConsoleLogger("info").child("d1")
});
```

## Schema

`ensureSchema()` runs once on `connect()` as a single `db.batch()` of
idempotent `CREATE TABLE/INDEX IF NOT EXISTS` statements. All tables
are namespaced by a `key_prefix` column; all timestamps are integer
Unix-ms computed in JS and bound as parameters (SQLite has no
`now()`/`interval`).

```sql
chat_state_subscriptions (
  key_prefix  TEXT,
  thread_id   TEXT,
  created_at  INTEGER,
  PRIMARY KEY (key_prefix, thread_id)
)

chat_state_locks (
  key_prefix  TEXT,
  thread_id   TEXT,
  token       TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (key_prefix, thread_id)
)  -- + index on expires_at

chat_state_cache (
  key_prefix  TEXT,
  cache_key   TEXT,
  value       TEXT    NOT NULL,
  expires_at  INTEGER,            -- NULL = no expiry
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (key_prefix, cache_key)
)  -- + index on expires_at

chat_state_lists (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_prefix  TEXT,
  list_key    TEXT,
  value       TEXT    NOT NULL,
  expires_at  INTEGER             -- NULL = no expiry
)  -- + index (key_prefix, list_key, seq), index expires_at

chat_state_queues (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_prefix  TEXT,
  thread_id   TEXT,
  value       TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL
)  -- + index (key_prefix, thread_id, seq), index expires_at
```

## D1 atomicity & RETURNING

D1 has no interactive transactions. Compound operations use
`database.batch([...])`, which runs the statements sequentially in one
implicit transaction and returns an array of results (each with
`.results` and `.meta`). Single statements are individually atomic.

D1's SQLite supports `RETURNING` in all the forms this adapter needs
(verified against real D1):

- `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING` — used by
  `acquireLock`. Returns **no row** when the `WHERE` clause blocks the
  update (live lock), a row when it inserts or steals an expired lock.
- `INSERT ... ON CONFLICT DO NOTHING RETURNING` (inside a batch) —
  used by `setIfNotExists`; the returned-row count tells us whether we
  inserted.
- `DELETE ... WHERE seq = (SELECT ... ) RETURNING value` — used by
  `dequeue`.
- `UPDATE ... RETURNING` and `meta.changes` both work; `extendLock`
  uses `meta.changes > 0`.

## Locking / queue / list semantics

These match `state-memory` exactly:

- **Locks** — token is `d1_${crypto.randomUUID()}`. `releaseLock` and
  `extendLock` are token-scoped no-ops on mismatch; `forceReleaseLock`
  ignores the token. Expired locks are stealable.
- **Cache** — a stored `null` is a real value, distinct from a miss.
  Falsy `ttlMs` (including `0` and `undefined`) means **no expiry**
  (`expires_at` is `NULL`). Reads filter on
  `expires_at IS NULL OR expires_at > now`.
- **Lists** — keep newest `maxLength` via
  `DELETE ... WHERE seq NOT IN (SELECT seq ... ORDER BY seq DESC LIMIT n)`.
  Appending refreshes the TTL on **all** entries of the key. `getList`
  purges expired rows then reads in `seq ASC` (insertion) order; empty
  list → `[]`.
- **Queues** — FIFO by `seq`. On overflow keep newest `maxSize` (drop
  oldest). Expired entries are purged on enqueue/dequeue and excluded
  from `queueDepth`. Queues are isolated by `thread_id`.

JSON values are stored as `text` and read back with `JSON.parse` plus
a raw-string fallback (mirrors `state-pg`).

## Connection management

- `connect()` is idempotent and deduplicates concurrent attempts via a
  stored promise; it runs `ensureSchema()` and sets `connected`.
- `disconnect()` flips `connected` to `false` and clears the connect
  promise — the binding is owned by the runtime, so there is nothing
  to close. The adapter is re-startable (connect → disconnect →
  connect works).
- Every method calls `ensureConnected()`, which throws
  `"D1StateAdapter is not connected. Call connect() first."` when not
  connected.

## Coding conventions

- Named exports only; no default export.
- SQL `CREATE` DDL lives as named template-literal constants at the
  top of `index.ts`.
- Use parameterized `.bind(...)` everywhere — never concatenate input
  into SQL.
- `any` is banned (`unknown` instead); interfaces over type-aliases
  for object shapes; `for...of` over index loops; throw `Error`
  objects; no `console.log`; top-level regex literals only.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/state-d1` plus `chat` if a public `StateAdapter` type
changed). Schema-changing PRs should note the new DDL so existing
deployments understand what the next `connect()` will run.

## Where to look next

- README: [`packages/state-d1/README.md`](README.md)
- Core StateAdapter contract: [`packages/chat/src/types.ts`](../chat/src/types.ts)
- Sibling state adapters:
  - [`packages/state-memory`](../state-memory) — canonical semantics
  - [`packages/state-pg`](../state-pg) — structural model
  - [`packages/state-redis`](../state-redis)
