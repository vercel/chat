---
"@chat-adapter/telegram": minor
---

Support Telegram guest mode. The adapter now routes `guest_message` updates to `onNewMention`, with each guest call in its own `telegram:guest:{chatId}:{guestQueryId}` thread. Replies go through `answerGuestQuery`, and edits and streamed updates address the reply by its `inline_message_id`. Business mode's explicit polling `allowed_updates` list now includes `guest_message`.
