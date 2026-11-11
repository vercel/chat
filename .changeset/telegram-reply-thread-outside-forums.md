---
"@chat-adapter/telegram": minor
---

Keep replies in a regular supergroup on the chat's thread. Outside forums, Telegram also sets `message_thread_id` on replies to identify the reply thread, and the adapter turned that into a separate `telegram:{chatId}:{messageThreadId}` thread. A bot subscribed to the chat never saw the reply. The adapter now uses `message_thread_id` as a thread only when `is_topic_message` is `true`, so forum topics keep their own threads.

Upgrading: in a regular supergroup, replies now arrive on `telegram:{chatId}`. Anything your bot keyed on a `telegram:{chatId}:{n}` thread ID from such a group, such as subscriptions and `thread.setState` values, stops matching. Unless the bot is also subscribed to the chat itself, follow-ups in those reply threads reach `onNewMention` or `onNewMessage` instead of `onSubscribedMessage`. Calling `thread.subscribe()` from a reply now subscribes the bot to the whole chat, and `thread.post()` from a reply's handler no longer sends `message_thread_id`. Use `thread.reply()` to answer a specific message. Reply chains in the chat share one thread lock, so the `concurrency` strategy applies across them: with the default `drop`, a message that arrives while a handler is running for the same chat is discarded.

Stop posting to stored `telegram:{chatId}:{n}` IDs from a regular supergroup. The adapter still sends `message_thread_id` for them and returns the message on the stored ID, while replies to it arrive on `telegram:{chatId}`.
