---
"@chat-adapter/discord": patch
---

Fix Discord slash command interactions to dispatch `ApplicationCommand` events through `chat.processSlashCommand`, while preserving deferred ACK responses.

This makes `chat.onSlashCommand(...)` handlers run for Discord webhooks and includes command option text parsing for nested options.
