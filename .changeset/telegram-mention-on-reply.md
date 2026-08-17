---
"@chat-adapter/telegram": minor
---

Add `mentionOnReply`: when enabled, a reply to one of the bot own messages reports `isMention`, so a bot in a group keeps the conversation going without the handle being repeated. Off by default — existing mention-only bots are unaffected — and readable from `TELEGRAM_MENTION_ON_REPLY`.
