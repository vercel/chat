---
"@chat-adapter/whatsapp": patch
"chat": patch
---

Preserve literal tildes and backslashes in outgoing WhatsApp Markdown instead of adding visible Markdown escapes. Render bold and strikethrough from their AST nodes so formatting markers inside inline and fenced code remain unchanged. Expose typed serialization handlers in `stringifyMarkdown` for platform-specific output.
