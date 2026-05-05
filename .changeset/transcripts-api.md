---
"chat": minor
---

Add Transcripts API for cross-platform per-user message persistence.

`bot.transcripts` (when configured via `ChatConfig.transcripts` + `ChatConfig.identity`) provides `append` / `list` / `count` / `delete` keyed by a stable cross-platform user key. Backed by the existing `StateAdapter.appendToList` primitive, so every built-in state adapter (`memory`, `redis`, `ioredis`, `pg`) supports it with no changes.

- `IdentityResolver` runs once per inbound message during dispatch; the result is cached on the `Message` instance as `message.userKey`.
- Distinct from the existing per-thread `threadHistory` config (which backfills thread context for adapters that lack server-side history).
- `delete` wipes every stored entry under a user key. Single-entry and time-range deletes are not part of this API — the underlying `appendToList` primitive can't support them safely under concurrent writes.
