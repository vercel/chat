---
"@chat-adapter/whatsapp": minor
"@chat-adapter/shared": patch
---

Implement outbound file and attachment sending for the WhatsApp adapter.

Supports binary `FileUpload` uploads, typed `Attachment` payloads (binary or HTTPS link passthrough), multi-file sequential sends, smart MIME-to-message-type mapping, caption placement with audio/long-text fallbacks, and card+file sequencing. Adds `whatsapp` to shared `PlatformName` for buffer utilities.
