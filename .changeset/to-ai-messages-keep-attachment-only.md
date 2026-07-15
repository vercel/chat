---
"chat": patch
---

`toAiMessages` no longer drops messages that have no text. Messages with image/file attachments or links but an empty text body (e.g. an image uploaded without a caption) are now included; only messages with no text, attachments, or links are skipped.
