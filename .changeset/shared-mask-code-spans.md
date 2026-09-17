---
"@chat-adapter/shared": patch
---

Add `maskCodeSpans`, which blanks inline code spans and fenced code blocks using the same scanner as `replaceBareMentions`, so adapters can classify a mention token while ignoring the ones inside code.
