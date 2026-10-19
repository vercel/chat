---
"@chat-adapter/whatsapp": patch
---

Send replies, reactions, read receipts, typing indicators, and media uploads from the phone number encoded in the thread. Outbound calls now throw a `ValidationError` before making any request when the thread ID doesn't decode or its phone number ID isn't numeric.
