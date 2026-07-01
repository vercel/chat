---
"@chat-adapter/discord": patch
---

fix: render bare URLs and autolinks as bare URLs instead of `[url](url)` masked links, which Discord only renders inside embeds (in normal messages they showed up as literal text)
