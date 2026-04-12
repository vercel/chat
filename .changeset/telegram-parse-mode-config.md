---
"@chat-adapter/telegram": minor
---

Add `parseMode` config option to `TelegramAdapterConfig`. Allows callers to opt
into `MarkdownV2`, `HTML`, or disable `parse_mode` entirely (`"none"`). Defaults
to `"Markdown"` for backward compatibility.
