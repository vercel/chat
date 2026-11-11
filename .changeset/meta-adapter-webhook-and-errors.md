---
"@chat-adapter/messenger": patch
"@chat-adapter/instagram": patch
"@chat-adapter/whatsapp": patch
---

Messenger, Instagram, and WhatsApp now verify webhooks with the same shared code. The `X-Hub-Signature-256` header must be `sha256=` followed by exactly 64 hex digits, and any other shape is rejected before the comparison. WhatsApp's log entry for a failed subscription check no longer includes `tokenMatch`. If computing the signature throws, WhatsApp now logs a warning and responds with 401, as Messenger and Instagram respond with 403.

Messenger rate-limit errors now carry `retryAfter` from the `Retry-After` header, as Instagram's already did. Both adapters accept the header as whole seconds or as an HTTP date, and ignore any other value, such as `1.5` or `30abc`. When the Graph API returns an error status with a body that isn't JSON, Messenger and Instagram now map it by status, so a 429 becomes an `AdapterRateLimitError` where it used to be a `NetworkError` about parsing the response.
