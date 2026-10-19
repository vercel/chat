---
"@chat-adapter/whatsapp": patch
"chat": minor
---

Keep literal tildes, asterisks, underscores, and backslashes as written in outgoing WhatsApp messages. A backslash escape is kept only where the text would otherwise turn into WhatsApp formatting, such as `\_word\_` or a line starting with `\>`. Render bold, italic, and strikethrough from their AST nodes so formatting markers inside inline and fenced code stay unchanged, and send hard breaks as plain newlines. Add a `handlers` option to `stringifyMarkdown` for platform-specific serialization.
