---
"@chat-adapter/slack": patch
---

Continue a native Slack stream in a new message before its text passes Slack's 12,000-character limit, instead of failing the reply with `msg_too_long`.
