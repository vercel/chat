---
"@chat-adapter/telegram": patch
---

Rich messages now escape `$` outside code and send single line breaks as hard breaks. Telegram's rich-message parser reads `$...$` as inline math, so text such as `~$950 (-3.3% from $983.23)` rendered as a formula, and it joined lines separated by a single newline into one paragraph. Both `{ markdown }` and `{ ast }` posts, edits, and streamed rich messages now keep dollar amounts and line-per-item text as written. Inline code, code blocks, link URLs, and autolinks are unchanged. Markdown that relied on `$...$` to render a formula now shows the dollar signs as text.
