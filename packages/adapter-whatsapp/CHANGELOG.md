# @chat-adapter/whatsapp

## 4.34.0

### Minor Changes

- 2338a66: Add `sendTemplate()` for sending pre-approved template messages, enabling business-initiated conversations outside the 24-hour customer service window
- 8bd8a57: Implement outbound file and attachment sending for the WhatsApp adapter.

  Supports binary `FileUpload` uploads, typed `Attachment` payloads (binary or HTTPS link passthrough), multi-file sequential sends, smart MIME-to-message-type mapping, caption placement with audio/long-text fallbacks, and card+file sequencing.

### Patch Changes

- Updated dependencies [5c926f1]
- Updated dependencies [2531a42]
- Updated dependencies [1721fa0]
- Updated dependencies [4717a38]
- Updated dependencies [6714efc]
  - chat@4.34.0
  - @chat-adapter/shared@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [3abdc69]
- Updated dependencies [0b63791]
- Updated dependencies [0c761f1]
- Updated dependencies [ef2542c]
- Updated dependencies [24a04d5]
- Updated dependencies [d4c52ca]
- Updated dependencies [076fe5d]
  - chat@4.33.0
  - @chat-adapter/shared@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [eccc6b9]
- Updated dependencies [438f551]
- Updated dependencies [d034b8b]
- Updated dependencies [06af3e1]
- Updated dependencies [2e47351]
- Updated dependencies [efa9610]
  - chat@4.32.0
  - @chat-adapter/shared@4.32.0

## 4.31.0

### Patch Changes

- Updated dependencies [778ae69]
- Updated dependencies [171657a]
  - chat@4.31.0
  - @chat-adapter/shared@4.31.0

## 4.30.0

### Minor Changes

- ffc43fc: Add WhatsApp typing indicator support by sending Meta's read-plus-typing payload when a recent inbound message is available. Update the default API version to v25.0.

### Patch Changes

- 9b8d8c4: expand npm `keywords` for adapter and state packages to improve discoverability (adds `chat-sdk`, `chatbot`, `ai-agent`, `ai-sdk`, `vercel`, plus platform-specific terms)
- Updated dependencies [5461ea9]
  - chat@4.30.0
  - @chat-adapter/shared@4.30.0

## 4.29.0

### Minor Changes

- 2ffed48: Adapter internals are now `protected` rather than `private`, so consumers can subclass an adapter to override or extend its behavior (e.g. handling additional Telegram update types by overriding `processUpdate`).

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
- Updated dependencies [add2730]
- Updated dependencies [b75eedb]
  - chat@4.29.0
  - @chat-adapter/shared@4.29.0

## 4.28.1

### Patch Changes

- Updated dependencies [0cc3d06]
  - chat@4.28.1
  - @chat-adapter/shared@4.28.1

## 4.28.0

### Patch Changes

- 46d183b: Rename `messageHistory` → `threadHistory` (with backwards compatibility).

  The per-thread history cache was previously named `messageHistory`, which collides conceptually with the new cross-platform per-user Transcripts API. Renamed to `threadHistory` to make the distinction clear.

  **Renamed:**

  - `ChatConfig.messageHistory` → `ChatConfig.threadHistory`
  - `Adapter.persistMessageHistory` → `Adapter.persistThreadHistory`
  - `MessageHistoryCache` → `ThreadHistoryCache`
  - `MessageHistoryConfig` → `ThreadHistoryConfig`
  - File `message-history.ts` → `thread-history.ts`

  **Backwards compatibility:**

  - The old `ChatConfig.messageHistory` field is still read; `threadHistory` takes precedence when both are set.
  - The old `Adapter.persistMessageHistory` flag is still read; either flag being `true` enables persistence.
  - `MessageHistoryCache` and `MessageHistoryConfig` are re-exported as deprecated aliases of the new names.
  - The state-adapter storage key prefix (`msg-history:`) is **unchanged** — renaming it would silently orphan existing data.

  The `@chat-adapter/telegram` and `@chat-adapter/whatsapp` adapters now use `persistThreadHistory`. Custom adapters built against `persistMessageHistory` continue to work unchanged.

- Updated dependencies [eb5f94a]
- Updated dependencies [c1cd9b5]
- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - chat@4.28.0
  - @chat-adapter/shared@4.28.0

## 4.27.0

### Minor Changes

- 6b17c60: Add `apiUrl` config option for custom API endpoint configuration (e.g. GovSlack, GitHub Enterprise, GCC-High Teams)

### Patch Changes

- 1e7c551: restore attachment fetchData after queue/debounce serialization
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
  - @chat-adapter/shared@4.27.0

## 4.26.0

### Patch Changes

- Updated dependencies [2235c16]
- Updated dependencies [ddb084b]
  - chat@4.26.0
  - @chat-adapter/shared@4.26.0

## 4.25.0

### Patch Changes

- Updated dependencies [2700ce8]
  - chat@4.25.0
  - @chat-adapter/shared@4.25.0

## 4.24.0

### Patch Changes

- 8d89274: fix: disable source maps in published packages
- Updated dependencies [8d89274]
- Updated dependencies [4f5d200]
- Updated dependencies [27b34e1]
  - @chat-adapter/shared@4.24.0
  - chat@4.24.0

## 4.23.0

### Patch Changes

- Updated dependencies [4166e09]
  - chat@4.23.0
  - @chat-adapter/shared@4.23.0

## 4.22.0

### Patch Changes

- Updated dependencies [f2d8957]
  - chat@4.22.0
  - @chat-adapter/shared@4.22.0

## 4.21.0

### Minor Changes

- d778f72: Switch adapters from optional dep to full dep on chat

### Patch Changes

- Updated dependencies [e45a67f]
- Updated dependencies [13ba1c7]
- Updated dependencies [95fd8ce]
  - chat@4.21.0
  - @chat-adapter/shared@4.21.0

## 4.20.2

### Patch Changes

- chat@4.20.2
- @chat-adapter/shared@4.20.2

## 4.20.1

### Patch Changes

- Updated dependencies [e206371]
- Updated dependencies [8d88b8c]
  - chat@4.20.1
  - @chat-adapter/shared@4.20.1

## 4.20.0

### Minor Changes

- 60f5d8e: Add WhatsApp adapter using Meta's WhatsApp Business Cloud API

### Patch Changes

- chat@4.20.0
- @chat-adapter/shared@4.20.0
