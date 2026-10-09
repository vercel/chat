---
"@chat-adapter/slack": patch
---

Fix backward thread history reads returning older replies when a Slack thread spans multiple API pages. Backward reads now follow every `conversations.replies` page before selecting the newest messages, so long threads take one API call per page.
