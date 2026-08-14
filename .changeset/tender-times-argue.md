---
"@chat-adapter/telegram": minor
---

Use post-and-edit streaming by default and make native Telegram drafts opt-in. Streams now render the same way in every chat type; set the new `nativeStreaming: true` config option to restore draft previews in private chats.

The adapter now owns the post-and-edit loop so edits stay under Telegram's per-chat rate limit. Edits are throttled to a 1100ms floor, configurable with the new `streamingEditIntervalMs` option, and a rate-limited final edit is retried once instead of failing the post.
