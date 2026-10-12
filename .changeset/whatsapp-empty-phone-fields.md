---
"@chat-adapter/whatsapp": patch
---

Treat empty `from` and `wa_id` values as absent, so messages from username users who hide their phone number reach handlers instead of being dropped.
