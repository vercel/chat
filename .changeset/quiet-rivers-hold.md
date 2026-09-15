---
"@chat-adapter/shared": patch
---

Enforce the guarded download deadline inside `downloadAttachment` itself, for both the wait for response headers and the body read. A late response is destroyed, so the timeout holds even when a custom transport ignores the supplied signal.
