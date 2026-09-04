---
"@chat-adapter/telegram": minor
---

Add Telegram Business mode support. Opt in via `businessMode: true`.

The adapter handles `business_connection`, `business_message`, and `edited_business_message` updates, encodes business threads as `telegram:biz:{connectionId}:{chatId}`, and passes `business_connection_id` on outbound sends, edits, typing, file uploads, and inline-keyboard callbacks. Business threads are their own channel, slash commands route through `onSlashCommand`, deletes use `deleteBusinessMessages`, and connection state is cached in the state adapter so a revoked connection is honoured by every instance. Reactions on business threads throw a `NotImplementedError`, since the Bot API has no business variant of `setMessageReaction`.
