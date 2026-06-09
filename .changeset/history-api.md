---
"chat": minor
---

Introduce the unified History API (`bot.history`) with user, thread, and channel scopes.

`bot.history.user` replaces `bot.transcripts` for cross-platform per-user message persistence. The API surface is identical — migrate by changing the `transcripts` config key to `history.user` and updating call sites from `bot.transcripts.*` to `bot.history.user.*`. `bot.transcripts` remains available as a deprecated alias.

`bot.history.thread` and `bot.history.channel` expose promise-based helpers for per-thread and per-channel message access, aligned with the existing `thread.messages` and `channel.threads()` iterators.

The `TranscriptEntry` type is deprecated in favour of `HistoryEntry`. Both are exported from `chat`.
