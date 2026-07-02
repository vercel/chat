---
"@chat-adapter/slack": patch
---

Process Slack Socket Mode retry envelopes instead of discarding them. Slack redelivers an event (immediately, +1 min, +5 min) when a prior delivery wasn't acknowledged — including events sent while the app had no open socket, e.g. during a restart or a routine connection refresh. The adapter previously acked and dropped every envelope with `retry_num > 0`, so such events were permanently lost even though Slack redelivered them. Retries are now routed like first deliveries (logged at info with `retry_num`/`retry_reason`); `Chat.processMessage`'s message-id dedupe drops true duplicates.
