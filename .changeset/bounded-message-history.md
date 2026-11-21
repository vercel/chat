---
"@chat-adapter/shared": minor
"@chat-adapter/telegram": patch
"@chat-adapter/messenger": patch
"@chat-adapter/instagram": patch
---

Add `MessageStore` to `@chat-adapter/shared`, an in-memory message store that keeps the newest 100 messages of each thread and stays within a size budget of about 64 MB across all threads. The Telegram, Messenger, and Instagram adapters now use it for the messages `fetchMessages` returns, so the cache no longer grows with every message the process sees. Older messages beyond those limits are no longer returned.
