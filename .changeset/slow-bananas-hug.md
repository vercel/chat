---
"@chat-adapter/discord": patch
"@chat-adapter/gchat": patch
"@chat-adapter/github": patch
"@chat-adapter/linear": patch
"@chat-adapter/messenger": patch
"@chat-adapter/slack": patch
"@chat-adapter/teams": patch
"@chat-adapter/telegram": patch
"@chat-adapter/web": patch
"@chat-adapter/whatsapp": patch
---

Adapter internals are now `protected` rather than `private`, so consumers can subclass an adapter to override or extend its behavior (e.g. handling additional Telegram update types by overriding `processUpdate`).
