---
"@chat-adapter/shared": minor
"@chat-adapter/messenger": patch
---

Move webhook verification, Graph API error mapping, callback data encoding, card helpers, and in-memory message pagination that Messenger, Instagram, and WhatsApp each implemented into `@chat-adapter/shared`. Telegram and Twilio now use the shared callback data codec too, and `@chat-adapter/shared/callback-data` exposes it as a dependency-free subpath. Messenger rate-limit errors now carry `retryAfter` from the `Retry-After` header, as Instagram's already did.
