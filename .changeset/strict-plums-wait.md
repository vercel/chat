---
"@chat-adapter/messenger": minor
"@chat-adapter/whatsapp": minor
"@chat-adapter/x": minor
"chat": minor
---

Add a shared thread API for marking messages as read across WhatsApp, Messenger, and XChat.

Note for anyone calling `XchatAdapter.markAsRead()` directly: it now rejects when a receipt fails instead of logging a warning and resolving. Automatic read receipts are unaffected, since the adapter still catches and logs those internally. If you call the method yourself without awaiting it, add a `.catch()` so a failed receipt does not surface as an unhandled rejection.
