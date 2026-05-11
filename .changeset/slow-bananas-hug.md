---
"@chat-adapter/discord": minor
"@chat-adapter/gchat": minor
"@chat-adapter/github": minor
"@chat-adapter/linear": minor
"@chat-adapter/messenger": minor
"@chat-adapter/slack": minor
"@chat-adapter/teams": minor
"@chat-adapter/telegram": minor
"@chat-adapter/web": minor
"@chat-adapter/whatsapp": minor
---

Adapter internals are now `protected` rather than `private`, so consumers can subclass an adapter to override or extend its behavior (e.g. handling additional Telegram update types by overriding `processUpdate`).
