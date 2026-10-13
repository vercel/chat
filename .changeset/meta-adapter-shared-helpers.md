---
"@chat-adapter/shared": minor
"@chat-adapter/messenger": patch
---

Move webhook verification, Graph API error mapping, callback data encoding, card helpers, and in-memory message pagination that Messenger, Instagram, and WhatsApp each implemented into `@chat-adapter/shared`. Messenger rate-limit errors now carry `retryAfter` from the `Retry-After` header, as Instagram's already did.
