---
"@chat-adapter/webhook": minor
"@chat-adapter/catalog": minor
"create-chat-sdk": minor
---

Add a generic webhook adapter for platforms without a dedicated adapter. You supply a `parse` function that maps a verified webhook request to messages and a `send` function that delivers replies over HTTP, plus optional `edit`, `delete`, and `startTyping` callbacks. Requests are verified with an HMAC-SHA256 signature using `WEBHOOK_SECRET`, or with your own `verify` function. The adapter catalog and `create-chat-sdk` now include it.
