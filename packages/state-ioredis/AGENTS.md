# AGENTS.md — `@chat-adapter/state-ioredis`

Guidance for coding agents working inside the ioredis state adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/state-ioredis` is the same Chat SDK state contract as
`@chat-adapter/state-redis` but built on
[`ioredis`](https://www.npmjs.com/package/ioredis). Pick this variant
when you need:

- **Cluster mode** — `ioredis` ships first-class Redis Cluster
  support, including topology refresh, MOVED redirection, and
  CROSSSLOT-safe hash tags.
- **Sentinel** — automatic failover via Redis Sentinel.
- **Pub/Sub** + commands on the same client — `ioredis` allows it
  (`node-redis` doesn't without separate clients).
- An existing codebase already standardised on `ioredis`.

If none of these apply, prefer `@chat-adapter/state-redis` for its
smaller dependency footprint.

## Directory layout

```
packages/state-ioredis/
├── src/
│   ├── index.ts             # IoRedisStateAdapter + createIoRedisState
│   └── index.test.ts        # full StateAdapter contract suite
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

The package mirrors `state-redis` line-for-line where possible so
fixes apply to both. Behavioural deviations are limited to what
`ioredis` and `node-redis` express differently (transaction syntax,
script caching, cluster routing).

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/state-ioredis build
pnpm --filter @chat-adapter/state-ioredis test
```

The unit tests use a `vi.fn()`-backed `ioredis` stub. Real Redis
integration tests live in
`packages/integration-tests/src/state-ioredis.test.ts` and run only
when `REDIS_URL` is exported.

## Public surface

Main exports from `src/index.ts`:

- `createIoRedisState(options)` — primary factory. Requires either a
  `url` or an existing `client`; there is no `REDIS_URL`
  auto-detection (unlike `createRedisState`).
- `IoRedisStateAdapter` class — implements the Chat SDK
  `StateAdapter` interface. Public methods: subscriptions, locks,
  cache, lists, queues, plus `disconnect()`.
- `IoRedisStateAdapterOptions` — options type, a union of the
  url-based and client-based variants.

## Configuration

```typescript
import { createIoRedisState } from "@chat-adapter/state-ioredis";

// With a connection URL
createIoRedisState({
  url: process.env.REDIS_URL!,
  keyPrefix: "chat-sdk",
  logger: customLogger, // optional, defaults to a console logger
});

// Or with an existing ioredis client
createIoRedisState({ client: existingIoredisInstance });
```

For cluster:

```typescript
import { Cluster } from "ioredis";

const cluster = new Cluster([
  { host: "node-a", port: 6379 },
  { host: "node-b", port: 6379 },
]);

createIoRedisState({ client: cluster });
```

For sentinel:

```typescript
import Redis from "ioredis";

const client = new Redis({
  sentinels: [{ host: "sentinel-a", port: 26379 }],
  name: "mymaster",
});

createIoRedisState({ client });
```

## Internal key layout

Identical to `state-redis`:

```
{prefix}:subs:{threadId}
{prefix}:lock:{lockId}
{prefix}:cache:{cacheKey}
{prefix}:list:{listKey}
{prefix}:queue:{queueKey}
{prefix}:queue:{queueKey}:dedupe
```

Cluster mode uses hash-tag braces around the multi-key segment so
locks and cache keys with the same logical ID land on the same slot:

```
{prefix}:{lockId}:lock              # tagged variant for cluster
```

The adapter selects the tagged or untagged form based on whether the
client reports a cluster topology — see the
`isClusterClient(client)` helper.

## Locking semantics

`acquireLock(lockId, ttlMs)` uses `SET key value NX PX ttl` exactly
as `state-redis` does. `releaseLock(lockId, token)` runs the same Lua
script via `EVALSHA` (with `EVAL` fallback on NOSCRIPT). Cluster
support is handled by `ioredis`'s built-in script management.

`forceReleaseLock(lockId)` is unconditional `DEL`.

## Capabilities

- Persistence — **yes**.
- Multi-instance — **yes**.
- Subscriptions — **yes**.
- Distributed locking — **yes**, atomic via Lua release script.
- Key-value cache — **yes**, with TTL.
- Lists — **yes**, with per-entry TTL.
- Queues — **yes**, with per-entry TTL + dedupe set.
- Automatic reconnect — **yes** (built into `ioredis`).
- Cluster — **yes**, with hash-tag slot routing.
- Sentinel — **yes**, via `ioredis` Sentinel transport.
- Key prefix namespacing — **yes**.

## Pipelines & transactions

`ioredis` exposes `pipeline()` separately from `multi()`. The adapter
uses `multi().exec()` for atomic composite operations (queue dedupe
check + enqueue, list trim + add) — pipelines are reserved for
performance optimisations that don't need atomicity.

## Connection management

If the caller passes a `client`, the adapter assumes it is already
connected and does **not** call `quit()` on `disconnect()`. If the
adapter creates its own client, it owns the lifecycle.

The adapter listens for `error`, `reconnecting`, and `end` events on
the client and forwards them to `logger`. There is no automatic
re-creation of clients — `ioredis` handles reconnection internally.

## Error handling

Mirrors `state-redis`:

- `WRONGPASS`/`NOAUTH` → `AuthenticationError`.
- `LOADING` / `BUSY` → `AdapterRateLimitError` with a short
  retry-after.
- Connection errors → `NetworkError`.

Cluster `CLUSTERDOWN` errors are surfaced as `NetworkError` so
handlers can apply uniform retry logic.

## Testing approach

- The contract tests in `index.test.ts` mirror the `state-redis`
  suite. Whenever you fix something in one, port the test (and fix)
  to the other.
- Real-cluster / real-Sentinel tests live in
  `packages/integration-tests/src/state-ioredis.test.ts` and run
  only with the env vars present.
- Cluster routing tests stub `ioredis.Cluster` with a `vi.fn()`
  shim that records the resolved nodes per command.

## Coding conventions

- Use named exports throughout. No default exports.
- All key construction goes through a single `prefixedKey` helper.
- Cluster-aware key construction lives in `keyTagged` — never
  inline `{}` brace concatenation.
- TTLs are stored as absolute epoch milliseconds for ZSET-backed
  structures and converted to relative ms (PX) for STRING-backed
  ones.
- Top-level regex literals only.
- Errors map to `@chat-adapter/shared` (`AuthenticationError`,
  `AdapterRateLimitError`, `NetworkError`).

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/state-ioredis` plus `chat` if a public `StateAdapter`
type changed). When fixing parity bugs, include both `state-redis`
and `state-ioredis` in the changeset.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/ioredis.mdx`](../../apps/docs/content/adapters/official/ioredis.mdx)
- README: [`packages/state-ioredis/README.md`](README.md)
- Core StateAdapter contract: [`packages/chat/src/state.ts`](../chat/src/state.ts)
- Sibling state adapters:
  - [`packages/state-memory`](../state-memory)
  - [`packages/state-redis`](../state-redis)
  - [`packages/state-pg`](../state-pg)
