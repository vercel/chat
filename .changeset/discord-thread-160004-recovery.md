---
"@chat-adapter/discord": patch
---

Fix silent thread creation failure when Discord returns error code 160004 ("A thread has already been created for this message"). The adapter now recovers by reusing the existing thread instead of falling back to a standalone channel message.
