# AGENTS.md — `@chat-adapter/state-memory`

Guidance for coding agents working inside the in-memory state adapter
package. The top-level repository [AGENTS.md](../../AGENTS.md) covers
monorepo-wide build, lint, and release rules — read it first. This
file documents the adapter-specific surface, conventions, and pitfalls.

## Overview

`@chat-adapter/state-memory` is the simplest state adapter — keeps
all subscriptions, locks, caches, lists, and queues in process
memory. Suitable for:

- Local development and tutorials.
- Single-process bots where durability is not a concern (and
  recovery from a restart is acceptable).
- Tests — the integration tests use it heavily because it has zero
  external dependencies and is deterministic.

It is **not** suitable for production multi-instance deployments. Pick
one of `@chat-adapter/state-redis`, `@chat-adapter/state-ioredis`, or
`@chat-adapter/state-pg` instead.

## Directory layout

```
packages/state-memory/
├── src/
│   ├── index.ts             # MemoryStateAdapter + createMemoryState
│   └── index.test.ts        # complete contract tests
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

There are no sub-modules — the in-memory adapter is small enough to
live in a single file.

## Build, test, typecheck

```bash
pnpm build
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm clean

# from repo root
pnpm --filter @chat-adapter/state-memory build
pnpm --filter @chat-adapter/state-memory test
```

The contract tests verify the full Chat SDK `StateAdapter` interface;
this is the canonical reference implementation, so the test file
doubles as documentation for what each method should do.

## Public surface

Main exports from `src/index.ts`:

- `createMemoryState(config?)` — primary factory. Accepts no
  arguments by default; a `keyPrefix` is the only option (used to
  namespace several MemoryStateAdapter instances inside the same
  process).
- `MemoryStateAdapter` class — implements the Chat SDK `StateAdapter`
  interface. Public methods cover subscriptions
  (`subscribe`/`unsubscribe`/`isSubscribed`/`listSubscriptions`),
  locks (`acquireLock`/`releaseLock`/`forceReleaseLock`), key/value
  cache (`get`/`set`/`delete`), lists (`appendToList`/`getList`),
  and queues (`enqueue`/`dequeue`/`peekQueue`/`clearQueue`).
- `MemoryStateAdapterConfig` — configuration type.

## Internal data model

The adapter keeps five maps in memory:

```typescript
const subscriptions = new Set<string>();
const locks = new Map<string, { token: string; expiresAt: number }>();
const cache = new Map<string, { value: string; expiresAt?: number }>();
const lists = new Map<string, Array<{ value: string; expiresAt?: number }>>();
const queues = new Map<string, Array<{ value: string; expiresAt: number }>>();
```

All keys are namespaced with `${keyPrefix}:${rawKey}` so multiple
adapter instances can coexist.

Expired entries are cleaned up lazily — every read checks
`expiresAt` and returns `undefined` (or omits the entry from list /
queue results) when the TTL has passed. There is no background
sweeper.

## Locking semantics

`acquireLock` issues a unique token per acquisition (UUID v4).
`releaseLock` only succeeds if the supplied token matches the stored
one — exactly the same semantics as the Redis adapters' `SET NX PX`
+ Lua release script.

Because the entire adapter runs inside one process, the locking is
cooperative. There is no contention model beyond JavaScript's
single-threaded event loop, so two awaits in the same event loop
tick can never race the lock.

`forceReleaseLock` deletes the entry unconditionally — used by the
Chat SDK's lock-conflict resolver.

## Capabilities

- Persistence — **no**. State lives in process memory only.
- Multi-instance — **no**. Each Node process has its own state.
- Subscriptions — **yes**.
- Distributed locking — **single-process only**.
- Key-value cache — **yes**, with TTL.
- Lists — **yes**, with per-entry TTL.
- Queues — **yes**, with per-entry TTL.
- Automatic reconnect — **n/a** (no transport).
- Cluster / Sentinel — **n/a**.
- Key prefix namespacing — **yes**, via `keyPrefix`.

## Use cases

- Local dev, especially when paired with the Web adapter:

  ```typescript
  import { Chat } from "chat";
  import { createMemoryState } from "@chat-adapter/state-memory";
  import { createWebAdapter } from "@chat-adapter/web";

  const bot = new Chat({
    userName: "mybot",
    adapters: { web: createWebAdapter({ userName: "mybot", getUser }) },
    state: createMemoryState(),
  });
  ```

- Unit and integration tests where a clean state adapter is desirable
  per `describe`. The `Chat` test kit (`@chat-adapter/tests`) wraps
  this adapter for contract test cases.

- Tutorials — every getting-started example in the docs uses this
  adapter so readers don't need a Redis cluster on their laptop.

## Anti-patterns

- **Don't use it in production with multiple replicas.** Each replica
  will hold its own subscription set; mentions can land on a replica
  that doesn't know the bot is subscribed.
- **Don't share a `MemoryStateAdapter` across processes via IPC.**
  Use a real distributed store instead.
- **Don't rely on `forceReleaseLock` as a regular control-flow tool.**
  It exists only to recover from a stuck lock when you can prove the
  holder is dead.
- **Don't grow lists unboundedly.** Memory adapters have no eviction;
  trim list / queue lengths in your handler logic.

## Testing approach

The bulk of the value of this package is the contract test suite in
`index.test.ts`. It exercises every method, every error case, and
every TTL boundary. When extending the `StateAdapter` interface,
update this file first — the test cases here become the spec the
Redis / Postgres adapters must also satisfy.

## Coding conventions

- Use named exports throughout. No default exports.
- All key construction goes through a single
  `prefixedKey(rawKey)` helper. Never inline string concatenation.
- TTLs are stored as absolute epoch milliseconds — never as
  duration values — so reads can compare against `Date.now()`
  without per-entry math.
- Errors thrown to chat-sdk callers are plain `Error` instances; the
  in-memory adapter has no auth or network failure modes.
- Top-level regex literals only.

## Releases

Behavioural changes need a changeset (`pnpm changeset`, choose
`@chat-adapter/state-memory` plus `chat` if a public `StateAdapter`
type changed). README and AGENTS.md edits don't.

## Where to look next

- User-facing docs: [`apps/docs/content/adapters/official/memory.mdx`](../../apps/docs/content/adapters/official/memory.mdx)
- README: [`packages/state-memory/README.md`](README.md)
- Core StateAdapter contract: [`packages/chat/src/state.ts`](../chat/src/state.ts)
- Sibling state adapters:
  - [`packages/state-redis`](../state-redis)
  - [`packages/state-ioredis`](../state-ioredis)
  - [`packages/state-pg`](../state-pg)
