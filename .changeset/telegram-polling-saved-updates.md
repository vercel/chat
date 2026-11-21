---
"@chat-adapter/telegram": patch
---

Polling mode now discards a message that the `drop` concurrency strategy rejects instead of saving it and retrying it. Messages for one chat that are fetched in the same `getUpdates` response count as arriving together, so one is handled and the rest are discarded; use the `queue` strategy to keep messages that arrive while a handler is running. Saved failed updates are now bounded: the adapter discards one after 10 failed attempts or one hour, keeps at most 1,000, and dispatches up to 100 per pass, with a retried update never sharing a pass with other saved work for its chat. The same limits apply to a checkpoint loaded when polling starts.
