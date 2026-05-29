# @chat-adapter/state-pg

## 4.29.0

### Patch Changes

- e60bc8c: chore: set supported Node versions in engines
- 06fb8e5: Align package shapes with the new `konsistent` conventions. All changes are
  backwards-compatible — previous type names are kept as deprecated aliases.

  - `@chat-adapter/gchat`, `@chat-adapter/slack`: moved `*AdapterConfig` (and
    related sub-types) into a `./types` module; the public re-exports from
    `index.ts` are unchanged.
  - `@chat-adapter/slack`: `createSlackAdapter` now accepts `SlackAdapterConfig`
    directly instead of `Partial<SlackAdapterConfig>`. Every field on the config
    was already optional, so no call sites need to change.
  - `@chat-adapter/messenger`: `MessengerAdapterConfig` fields are now optional
    (the factory still falls back to `FACEBOOK_*` env vars), and `logger` /
    `userName` live on `MessengerAdapterConfig` directly. The factory signature
    is now `createMessengerAdapter(config?: MessengerAdapterConfig)`.
  - `@chat-adapter/web`: renamed `WebAdapterOptions` to `WebAdapterConfig`; the
    old name is exported as a deprecated alias.
  - `@chat-adapter/whatsapp`: every field on `WhatsAppAdapterConfig` is optional
    (the factory still falls back to `WHATSAPP_*` env vars). `createWhatsAppAdapter`
    is now typed `(config?: WhatsAppAdapterConfig) => WhatsAppAdapter`.
  - `@chat-adapter/state-memory`: added an empty `MemoryStateAdapterOptions`
    type so the package matches every other state adapter; `createMemoryState`
    now accepts an optional argument of that type.
  - `@chat-adapter/state-ioredis`, `@chat-adapter/state-redis`,
    `@chat-adapter/state-pg`: the URL- and client-based option shapes were split
    into named interfaces (`*StateAdapterUrlOptions` /
    `*StateAdapterClientOptions`) and unified under `*StateAdapterOptions`. The
    factories now take the union type directly. Old names — `RedisStateClientOptions`,
    `CreateRedisStateOptions`, `PostgresStateClientOptions`,
    `CreatePostgresStateOptions`, `IoRedisStateClientOptions` — are kept as
    deprecated aliases.

- Updated dependencies [ac8a207]
- Updated dependencies [e60bc8c]
- Updated dependencies [b75eedb]
  - chat@4.29.0

## 4.28.1

### Patch Changes

- Updated dependencies [0cc3d06]
  - chat@4.28.1

## 4.28.0

### Patch Changes

- Updated dependencies [eb5f94a]
- Updated dependencies [c1cd9b5]
- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - chat@4.28.0

## 4.27.0

### Patch Changes

- Updated dependencies [8a0c7b3]
- Updated dependencies [1e7c551]
- Updated dependencies [b0ab804]
- Updated dependencies [d630e6c]
- Updated dependencies [b9a1961]
- Updated dependencies [a520797]
- Updated dependencies [70281dc]
- Updated dependencies [9093292]
- Updated dependencies [7e90d9c]
- Updated dependencies [bca4792]
- Updated dependencies [37dbb4a]
- Updated dependencies [608d5f0]
- Updated dependencies [a179b29]
- Updated dependencies [a8f2aab]
  - chat@4.27.0

## 4.26.0

### Patch Changes

- Updated dependencies [2235c16]
- Updated dependencies [ddb084b]
  - chat@4.26.0

## 4.25.0

### Patch Changes

- Updated dependencies [2700ce8]
  - chat@4.25.0

## 4.24.0

### Patch Changes

- 8d89274: fix: disable source maps in published packages
- Updated dependencies [8d89274]
- Updated dependencies [4f5d200]
- Updated dependencies [27b34e1]
  - chat@4.24.0

## 4.23.0

### Patch Changes

- Updated dependencies [4166e09]
  - chat@4.23.0

## 4.22.0

### Patch Changes

- Updated dependencies [f2d8957]
  - chat@4.22.0

## 4.21.0

### Patch Changes

- Updated dependencies [e45a67f]
- Updated dependencies [13ba1c7]
- Updated dependencies [95fd8ce]
  - chat@4.21.0

## 4.20.2

### Patch Changes

- chat@4.20.2

## 4.20.1

### Patch Changes

- Updated dependencies [e206371]
- Updated dependencies [8d88b8c]
  - chat@4.20.1

## 4.20.0

### Patch Changes

- chat@4.20.0

## 4.19.0

### Minor Changes

- eb49b2a: Add `forceReleaseLock` to StateAdapter and `onLockConflict` config option for interrupt/steerability of long-running handlers

### Patch Changes

- Updated dependencies [eb49b2a]
- Updated dependencies [5b41f08]
- Updated dependencies [c4b0e69]
  - chat@4.19.0

## 4.18.0

### Minor Changes

- 8fe175f: Add PostgreSQL state adapter using `postgres` for SQL-first production stacks

### Patch Changes

- Updated dependencies [a3cfc1a]
  - chat@4.18.0
