---
"@chat-adapter/gchat": patch
---

Incoming Google Chat messages keep literal asterisks, tildes, and code as written. Bold and strikethrough now only apply when the markers wrap text with no space just inside them, so `2 * 3` and `~10` stay as typed, and inline code and code blocks keep their asterisks.
