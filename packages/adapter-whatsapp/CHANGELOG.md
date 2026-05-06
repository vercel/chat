# @chat-adapter/whatsapp

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

- Updated dependencies [9824d33]
- Updated dependencies [46d183b]
- Updated dependencies [46d183b]
- Updated dependencies [3490a8c]
  - @chat-adapter/shared@4.28.0
  - chat@4.28.0

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
