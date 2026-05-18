# AGENTS.md — `@chat-adapter/state-redis`

Guidance for coding agents working inside the Redis state adapter
package (built on `node-redis`). The top-level repository
[AGENTS.md](../../AGENTS.md) covers monorepo-wide build, lint, and
release rules — read it first. This file documents the
adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/state-redis` persists Chat SDK state in Redis using
the [`redis`](https://www.npmjs.com/package/redis) (a.k.a.
`node-redis`) client. It covers:

- Subscriptions stored as a per-thread `EXISTS` flag.
- Distributed locks via `SET NX PX` + a Lua release script for
  token-checked atomic release.
- Key/value caching with optional TTL via `SETEX` / `EXPIRE`.
- Lists backed by Redis sorted sets (so list entries can have
  per-entry TTLs).
- Queues backed by Redis sorted sets keyed on enqueue time.
- Automatic key prefixing for multi-tenant isolation.

This is the recommended state adapter for production deployments on
managed Redis services (Vercel KV, Upstash, AWS ElastiCache,
Redis Cloud, etc.).

## Directory layout

```
packages/state-redis/
├── src/
│   ├── index.ts             # RedisStateAdapter + createRedisState
│   └── index.test.ts        # full StateAdapter contract suite
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

The package is intentionally small. Anything generic to Redis
adapters lives here; the ioredis variant in `state-ioredis`
re-implements the same surface against a different client.

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/state-redis build
pnpm --filter @chat-adapter/state-redis test
```

The unit tests use an in-memory Redis stub backed by `vi.fn()`. There
is no requirement to run a real Redis server for the contract tests.

## Public surface

Main exports from `src/index.ts`:

- `createRedisState(config?)` — primary factory. Auto-detects
  `REDIS_URL` (a.k.a. `KV_URL` for Vercel KV).
- `RedisStateAdapter` class — implements the Chat SDK `StateAdapter`
  interface. Public methods cover subscriptions, locks, cache, lists,
  queues, plus a `disconnect()` for graceful shutdown.
- `RedisStateAdapterConfig` — configuration type.

## Configuration

```typescript
createRedisState({
  url: process.env.REDIS_URL,    // or KV_URL
  client: existingRedisClient,    // bring your own connected client
  keyPrefix: "chat-sdk",          // namespace prefix
  logger: customLogger,
});
```

When neither `url` nor `client` is provided, the adapter falls back
to `REDIS_URL`. Connection setup is lazy — the first call connects
the client and subsequent calls reuse it. The adapter never owns the
client lifecycle when the caller passes one in via `client`; in that
case `disconnect()` is a no-op.

## Internal key layout

All keys are prefixed with `keyPrefix:` (default `"chat-sdk:"`).

```
{prefix}:subs:{threadId}            # SET-style subscription marker
{prefix}:lock:{lockId}              # STRING with token value, PX TTL
{prefix}:cache:{cacheKey}           # STRING value, optional EXPIRE
{prefix}:list:{listKey}             # ZSET entries, score = epoch ms
{prefix}:queue:{queueKey}           # ZSET entries, score = epoch ms
{prefix}:queue:{queueKey}:dedupe    # SET of dedupe keys (queue items only)
```

Sorted-set storage is used for lists and queues so per-entry TTLs
are achievable without `KEYSPACE-NOTIFICATIONS` magic. Reads filter
expired entries by score range; periodic `ZREMRANGEBYSCORE` calls
keep the index size bounded (the adapter runs them inline on each
write).

## Locking semantics

`acquireLock(lockId, ttlMs)`:

- Generates a unique token (UUID v4).
- Issues `SET {prefix}:lock:{lockId} {token} NX PX {ttlMs}`.
- Returns `{ token }` on success, `null` on contention.

`releaseLock(lockId, token)`:

- Runs an embedded Lua script that compares the stored token against
  the supplied one and `DEL`s only on match.
- Returns `true` if the lock was held by the caller and released,
  `false` otherwise.

`forceReleaseLock(lockId)` is `DEL {prefix}:lock:{lockId}` —
unconditional.

The Lua script is loaded with `SCRIPT LOAD` on first use and cached
by sha. If a Redis NOSCRIPT error fires, the adapter retries with
`EVAL`.

## Capabilities

- Persistence — **yes** (Redis durability rules apply).
- Multi-instance — **yes**.
- Subscriptions — **yes**.
- Distributed locking — **yes**, atomic via Lua release script.
- Key-value cache — **yes**, with TTL.
- Lists — **yes**, with per-entry TTL via ZSET scores.
- Queues — **yes**, with per-entry TTL + dedupe set.
- Automatic reconnect — **yes** (delegated to `node-redis`).
- Cluster — **yes**, when the supplied client is a Redis Cluster
  instance. Key prefixes use `{}` braces around the hash slot to
  avoid CROSSSLOT errors on multi-key operations.
- Sentinel — **via `client`** — pass a Sentinel-aware `node-redis`
  client.
- Key prefix namespacing — **yes**.

## Vercel KV

Vercel KV is API-compatible with `node-redis`. The adapter detects
KV deployments by reading `KV_URL` (alias of `REDIS_URL`) and
configuring TLS automatically. No additional config needed.

## Connection management

The adapter uses **one** Redis connection per `RedisStateAdapter`
instance. All commands run on the same client; transactions
(`MULTI`/`EXEC`) are used for the rare composite operations. Pipelines
are not used because the per-call latency is not the bottleneck.

If you bring your own `client`:

- The adapter assumes the client is already connected.
- The adapter does not call `disconnect()` on it.
- If your client has its own retry/timeout logic, it takes
  precedence.

## Error handling

`AuthenticationError` is thrown for `WRONGPASS`/`NOAUTH` errors,
`AdapterRateLimitError` for `LOADING` (Redis is loading the data
set), and `NetworkError` for connection failures. Other errors
propagate as plain `Error` instances since they typically indicate
programmer error (bad key, wrong type, etc.).

## Testing approach

- The contract tests in `index.test.ts` mirror the
  `state-memory` suite. Both packages must stay green against the
  same set of assertions.
- The Redis client is replaced with a `vi.fn()`-backed stub that
  records commands and returns canned responses. Reach for the stub
  helpers (`makeMockRedis`) rather than rolling your own.
- Real-Redis tests live in
  `packages/integration-tests/src/state-*.test.ts` and run against
  a local Redis instance only when `REDIS_URL` is exported.

## Coding conventions

- Use named exports throughout. No default exports.
- All key construction goes through a single `prefixedKey` helper —
  never inline string concatenation.
- Wrap multi-step operations in `MULTI`/`EXEC` when atomicity matters
  (e.g. queue dedupe + enqueue).
- TTLs are stored as absolute epoch milliseconds for ZSET-backed
  structures and converted to relative ms (PX) for STRING-backed
  ones.
- Top-level regex literals only.
- Errors thrown to chat-sdk callers come from `@chat-adapter/shared`
  (`AuthenticationError`, `AdapterRateLimitError`, `NetworkError`).

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/state-redis` plus `chat` if a public `StateAdapter`
type changed). README and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/redis.mdx`](../../apps/docs/content/adapters/official/redis.mdx)
- README: [`packages/state-redis/README.md`](README.md)
- Core StateAdapter contract: [`packages/chat/src/state.ts`](../chat/src/state.ts)
- Sibling state adapters:
  - [`packages/state-memory`](../state-memory)
  - [`packages/state-ioredis`](../state-ioredis)
  - [`packages/state-pg`](../state-pg)
