---
"chat": minor
---

feat: add SentMessage.liveUpdate() for rate-limited coalesced message editing

Adds `liveUpdate(content)` and `finishLiveUpdates(finalContent?)` methods to `SentMessage`. These provide a built-in mechanism for rapidly updating a message without hitting platform rate limits — updates are coalesced at a configurable interval (default 2.5s) so only the latest content is sent.

This is useful for streaming progress indicators, live status updates, and other scenarios where message content changes faster than platform APIs allow.
