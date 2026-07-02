---
"@chat-adapter/shared": minor
---

add `replaceBareMentions`, a context-aware bare-`@mention` resolver that skips code spans, URLs, schemeless hosts, and existing angle-bracket tokens before handing each real `@name` to a platform-specific replacer
