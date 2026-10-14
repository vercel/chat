---
"@chat-adapter/slack": patch
---

Cut Slack card text that goes past Block Kit's length limits, so a long value no longer makes Slack reject the message. This covers headers, section and muted text, subtitles, fields, link labels, button labels, image alt text, and select and radio options and placeholders. Cuts in mrkdwn text don't split a mention, link, or HTML entity, close a code fence left open, and keep the closing `*` of bold text.
