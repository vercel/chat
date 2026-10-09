---
"@chat-adapter/slack": patch
---

Fix backward thread history reads returning older replies when a Slack thread spans multiple API pages. Backward reads now follow every `conversations.replies` page before selecting the newest messages, so long threads take one API call per page. A repeated Slack pagination cursor now throws instead of looping, and `slack_webapi_rate_limited_error` maps to `AdapterRateLimitError`.
