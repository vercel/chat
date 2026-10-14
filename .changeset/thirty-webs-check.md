---
"@chat-adapter/slack": minor
"chat": minor
---

Isolate Slack message concurrency and turn cancellation by installation to prevent cross-workspace bot token reuse. Adapters can now namespace dedupe, lock, queue, and turn keys with the optional `Adapter.getConcurrencyScope()` hook. In multi-workspace mode, messages queued under the old keys aren't migrated, and old and new workers don't exclude each other, so upgrade `chat` and `@chat-adapter/slack` together and restart all workers.
