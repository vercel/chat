---
"chat": minor
"@chat-adapter/telegram": patch
"@chat-adapter/whatsapp": patch
---

Rename `messageHistory` → `threadHistory` (with backwards compatibility).

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
