---
"@chat-adapter/twilio": patch
"@chat-adapter/messenger": patch
---

Send literal text, line breaks, and bare addresses as written in outgoing Twilio and Messenger messages. Text such as `snake_case`, `3 * 4`, and `#1` no longer gets Markdown backslash escapes, hard breaks become plain newlines, and bare URLs, `www.` addresses, and email addresses are no longer wrapped as `<url>` or rewritten as `[www.example.com](http://www.example.com)`.
