---
"@chat-adapter/telegram": minor
---

Keep replies in a regular supergroup on the chat's thread. Outside forums, Telegram also sets `message_thread_id` on replies to identify the reply thread, and the adapter turned that into a separate `telegram:{chatId}:{messageThreadId}` thread. A bot subscribed to the chat never saw the reply. The adapter now uses `message_thread_id` as a thread only when `is_topic_message` is `true`, so forum topics keep their own threads.

Upgrading: in a regular supergroup, replies now arrive on `telegram:{chatId}`. Anything your bot keyed on a `telegram:{chatId}:{n}` thread ID from such a group, such as subscriptions and `thread.setState` values, stops matching. Unless the bot is also subscribed to the chat itself, follow-ups in those reply threads reach `onNewMention` or `onNewMessage` instead of `onSubscribedMessage`. Calling `thread.subscribe()` from a reply now subscribes the bot to the whole chat.
