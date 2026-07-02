---
"chat": patch
---

Raise the default message dedupe TTL from 5 to 10 minutes so it outlives the longest platform redelivery window. Slack's Events API retries up to ~5 minutes after the original delivery — exactly at the old TTL boundary, where a retried event could miss the expired dedupe entry from its first processing and be handled twice. Configurable behavior is unchanged (`dedupeTtlMs` still overrides).
