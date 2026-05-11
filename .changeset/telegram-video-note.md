---
"@chat-adapter/telegram": patch
---

Handle `video_note` (round video messages) in `extractAttachments`. Previously these messages were silently dropped; now they are returned as `video` attachments with `width`/`height` set to the clip's `length`.
