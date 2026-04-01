---
"@chat-adapter/slack": patch
---

Fix DM messages failing with `invalid_thread_ts` by guarding Slack API calls with `threadTs || undefined`
