---
"@chat-adapter/state-ioredis": patch
"@chat-adapter/state-memory": patch
"@chat-adapter/state-redis": patch
"chat": patch
---

fix: non-atomic message deduplication causes app_mention events to be silently dropped
