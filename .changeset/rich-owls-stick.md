---
"@chat-adapter/slack": patch
---

Fix backward thread history reads returning older replies when a Slack thread spans multiple API pages. Follow Slack's pagination cursors before selecting the newest messages, while preserving chronological order and the timestamp cursor for older reads. Include repeated thread parents once and respect the backward timestamp boundary.
