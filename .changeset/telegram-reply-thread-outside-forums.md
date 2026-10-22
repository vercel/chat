---
"@chat-adapter/telegram": patch
---

Keep replies in a regular supergroup on the chat's thread. Telegram sets `message_thread_id` on a reply outside forums, to the id of the message it answers, and the adapter turned that into a separate `telegram:{chatId}:{messageThreadId}` thread. A bot subscribed to the chat never saw the reply. The adapter now uses `message_thread_id` as a thread only when `is_topic_message` is `true`, so forum topics keep their own threads.
