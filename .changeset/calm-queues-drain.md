---
"chat": patch
---

Fix the `queue`, `burst`, and `debounce` concurrency strategies stranding a message that is enqueued between the lock holder's final empty dequeue and its lock release. The holder now re-checks the queue after releasing the lock, and a message that was enqueued retries the lock, so the queue is always drained.
