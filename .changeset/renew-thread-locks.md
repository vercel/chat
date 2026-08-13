---
"chat": patch
---

Keep thread locks alive while message handlers run so queue, burst, and debounce strategies remain serialized beyond the lock TTL.
