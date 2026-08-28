---
"chat": minor
---

Keep thread locks alive while message handlers run so queue, burst, and debounce strategies remain serialized beyond the lock TTL. Renewal is capped by the new `concurrency.maxLockLifetimeMs` option (default 10 minutes) so a hung handler cannot block a thread forever. When the heartbeat detects that lock ownership was lost, the queue drain and debounce loops stop instead of competing with the new lock holder, and the debounce loop now keeps draining messages that arrive while a handler is running instead of stranding them until the next webhook.
