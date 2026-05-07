---
"chat": minor
"@chat-adapter/discord": patch
"@chat-adapter/teams": patch
---

Add `callbackUrl` to `Button` and `Modal`. When a button is clicked or a modal is submitted, the SDK POSTs the action payload to `callbackUrl` in addition to firing any registered `onAction` / `onModalSubmit` handler. This pairs naturally with webhook-based workflow engines for awaitable button/modal flows.

Supported platforms: Slack, Teams, Google Chat, WhatsApp, Telegram, and Discord.
