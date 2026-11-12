---
"@chat-adapter/teams": minor
---

`postMessage`, `postChannelMessage`, and `editMessage` accept a raw Adaptive Card as `{ adaptiveCard, fallbackText }` and send it as is, for Adaptive Card features that Chat SDK cards don't cover, such as `Badge`. `fallbackText` becomes the activity's `summary`.
