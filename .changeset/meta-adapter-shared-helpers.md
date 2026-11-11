---
"@chat-adapter/shared": minor
---

Add helpers that Messenger, Instagram, and WhatsApp each implemented separately: Meta webhook verification (`verifyMetaWebhookChallenge`, `verifyMetaSignature`), Graph API error mapping (`throwMetaGraphApiError`), the `chat:{json}` callback data codec, `findCardActions` and `truncateWithEllipsis` for cards, in-memory message history (`upsertMessage`, `paginateMessages`), and `parseRetryAfter` for `Retry-After` headers given in seconds or as an HTTP date. Telegram and Twilio use the shared callback data codec too, and `@chat-adapter/shared/callback-data` exposes it as a dependency-free subpath.
