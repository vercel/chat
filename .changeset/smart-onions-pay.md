---
"@chat-adapter/telegram": patch
---

Stop cutting Telegram MarkdownV2 messages and captions at a backtick inside a link destination. Messages that fit the length limit now ship exactly as rendered, and a length cut that lands inside a link, code span, or underline now removes the incomplete entity before the ellipsis.
