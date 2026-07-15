---
"@chat-adapter/telegram": patch
---

Cache the compiled bot-mention regex in `isBotMentioned` instead of recompiling it per message, and make the protected `sleep` helper accept an optional `AbortSignal` so `stopPolling()` interrupts the polling backoff delay immediately.
