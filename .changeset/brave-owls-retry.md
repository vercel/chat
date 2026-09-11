---
"chat": patch
---

Retry initialization after a failed attempt. `Chat` no longer keeps a rejected initialization promise, so once the state adapter (for example Redis) recovers, the next `initialize()` call or webhook tries again instead of rejecting with the original connection error until the process restarts. Concurrent callers still share one attempt.
