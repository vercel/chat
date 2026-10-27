---
"@chat-adapter/telegram": minor
"@chat-adapter/catalog": patch
---

Add a `persistThreadHistory` option to the Telegram adapter. It defaults to `true`, so nothing changes unless you set it. With `false`, the Chat SDK stops saving Telegram messages in the state adapter, both incoming messages and the bot's own posts, for apps that keep their own transcript. `persistThreadHistory` is now typed `boolean`, so a subclass can also override it.
