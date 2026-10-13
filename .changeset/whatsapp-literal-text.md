---
"@chat-adapter/whatsapp": patch
"chat": patch
---

Send literal text in WhatsApp messages without Markdown backslash escapes, so `(~80 % easy)` no longer arrives as `(\~80 % easy)`. Formatting markers inside inline code and code blocks are no longer rewritten. `stringifyMarkdown` now accepts a `handlers` option for custom node serializers.
