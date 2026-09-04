---
"@chat-adapter/slack": patch
---

Stream post-and-edit fallback updates through Slack's `markdown_text` field instead of `text`, so live-updating messages render markdown while the stream is in progress (and get the 12,000-character ceiling rather than 4,000)
