---
"@chat-adapter/discord": patch
---

prevent email addresses and word@word handles from being mangled into Discord mentions (the bare-mention regex now requires the `@` to be at a word boundary)
