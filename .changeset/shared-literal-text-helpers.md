---
"@chat-adapter/shared": patch
---

Add `literalTextHandlers` and `unwrapBareLinks` for adapters whose platforms show Markdown syntax as typed. Pass `literalTextHandlers` to `stringifyMarkdown` to write text without backslash escapes and hard breaks as plain newlines. `unwrapBareLinks` returns a copy of an AST in which each link that GFM made from a bare URL, `www.` address, or email address is replaced by the address as text, so the address is sent as written. The Twilio and Messenger adapters use both.
