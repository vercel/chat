---
"@chat-adapter/slack": patch
---

Fix empty table cells causing `invalid_blocks` error from Slack API. Empty cells now fall back to a single space to satisfy the Block Kit requirement that cell text must be more than 0 characters.
