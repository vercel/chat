---
"chat": patch
"@chat-adapter/state-ioredis": patch
---

Stop describing the ioredis state adapter as supporting Redis Cluster. Its `client` option accepts an ioredis `Redis` instance, which a `Cluster` doesn't satisfy; Sentinel is still supported.
