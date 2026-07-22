---
"chat": patch
---

`toAiMessages` no longer drops messages that have no text. A message with an empty text body is now kept when it has links or attachments the converter can include: images and text files (`text/*`, JSON, XML, YAML, etc.) with a working `fetchData()`. Messages whose only attachments are unsupported (video, audio, other file types, or attachments without `fetchData()`) are still skipped, and `onUnsupportedAttachment` now fires for video/audio attachments on these previously filtered messages.

Note: multipart `content` no longer always starts with a text part. When a kept message had no text, its `content` array contains only attachment parts.
