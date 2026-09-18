---
"@chat-adapter/slack": patch
---

Tighten inbound mrkdwn bold/strikethrough matching to Slack's non-space rule, skip emphasis inside inline code, and convert `<mailto:…>` / `<tel:…>` link tokens to Markdown links.
