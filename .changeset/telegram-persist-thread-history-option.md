---
"@chat-adapter/telegram": minor
---

Add a `persistThreadHistory` option to the Telegram adapter. It defaults to `true`, so nothing changes unless you set it. With `false`, incoming messages are no longer copied into the Chat state adapter, for apps that keep their own transcript. `persistThreadHistory` is now typed `boolean`, so a subclass can also override it.
